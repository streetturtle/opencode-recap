/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { SyntaxStyle, TextAttributes } from "@opentui/core"

const PROMPTS_UNTIL_STALE = 3
const RECENT_MESSAGES = 10

// Module-level signals so the View component reacts to changes
const recapSignals = new Map<string, ReturnType<typeof createSignal<string | null>>>()
const loadingSignals = new Map<string, ReturnType<typeof createSignal<boolean>>>()
// Counts user prompts sent after the last recap was generated
const promptCounters = new Map<string, number>()

type RecapOptions = {
  providerID?: string
  modelID?: string
}

type ModelChoice = {
  providerID: string
  modelID: string
}

function readConfiguredModel(options: RecapOptions | undefined): ModelChoice | undefined {
  const providerID = options?.providerID?.trim()
  const modelID = options?.modelID?.trim()

  const hasProvider = Boolean(providerID)
  const hasModel = Boolean(modelID)

  if (hasProvider !== hasModel) {
    throw new Error("Invalid recap plugin config: set both providerID and modelID, or neither")
  }

  if (!hasProvider || !hasModel) return

  return {
    providerID: providerID!,
    modelID: modelID!,
  }
}

function inferSessionModel(messages: any[]): ModelChoice | undefined {
  const lastAssistant = [...messages]
    .reverse()
    .find((m: any) => {
      const info = m?.info ?? m
      const role = info?.role ?? m?.role
      return role === "assistant" && typeof info?.providerID === "string" && typeof info?.modelID === "string"
    })

  const info = lastAssistant?.info ?? lastAssistant
  const providerID = info?.providerID?.trim?.() ?? ""
  const modelID = info?.modelID?.trim?.() ?? ""
  if (!providerID || !modelID) return

  return { providerID, modelID }
}

function getRecapSignal(sessionID: string) {
  if (!recapSignals.has(sessionID)) recapSignals.set(sessionID, createSignal<string | null>(null))
  return recapSignals.get(sessionID)!
}

function getLoadingSignal(sessionID: string) {
  if (!loadingSignals.has(sessionID)) loadingSignals.set(sessionID, createSignal<boolean>(false))
  return loadingSignals.get(sessionID)!
}

function buildSyntaxStyle(api: TuiPluginApi): SyntaxStyle {
  const c = api.theme.current
  return SyntaxStyle.fromStyles({
    comment:     { fg: c.syntaxComment },
    keyword:     { fg: c.syntaxKeyword },
    function:    { fg: c.syntaxFunction },
    variable:    { fg: c.syntaxVariable },
    string:      { fg: c.syntaxString },
    number:      { fg: c.syntaxNumber },
    type:        { fg: c.syntaxType },
    operator:    { fg: c.syntaxOperator },
    punctuation: { fg: c.syntaxPunctuation },
  })
}

function View(props: { api: TuiPluginApi; session_id: string; onRecap: () => void }) {
  const theme = () => props.api.theme.current
  const recap = () => getRecapSignal(props.session_id)[0]()
  const loading = () => getLoadingSignal(props.session_id)[0]()
  const syntaxStyle = () => buildSyntaxStyle(props.api)

  return (
    <box>
      <text
        fg={loading() ? theme().textMuted : theme().text}
        attributes={TextAttributes.BOLD}
        onMouseDown={() => { if (!loading()) props.onRecap() }}
      >
        {loading() ? "Generating..." : "Recap"}
      </text>
      <Show when={recap() !== null && !loading()}>
        <markdown
          content={recap()!}
          syntaxStyle={syntaxStyle()}
          fg={theme().textMuted}
        />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const { slots, client, event } = api
  const recapOptions = options as RecapOptions | undefined
  let configuredRecapModel: ModelChoice | undefined
  let optionsError: string | undefined

  try {
    configuredRecapModel = readConfiguredModel(recapOptions)
  } catch (err: any) {
    optionsError = err?.message ?? String(err)
  }

  // Track user prompts per session and clear stale recaps
  event.on("session.status", (e: any) => {
    const sessionID: string = e.properties?.sessionID
    if (!sessionID) return
    const [recap] = getRecapSignal(sessionID)
    if (recap() === null) return

    if (e.properties?.status?.type === "busy") {
      const count = (promptCounters.get(sessionID) ?? 0) + 1
      promptCounters.set(sessionID, count)
      if (count >= PROMPTS_UNTIL_STALE) {
        const [, setRecap] = getRecapSignal(sessionID)
        setRecap(null)
        promptCounters.set(sessionID, 0)
      }
    }
  })

  async function generateRecap(sessionID: string) {
    const [, setRecap] = getRecapSignal(sessionID)
    const [, setLoading] = getLoadingSignal(sessionID)
    let recapSessionID: string | undefined
    let idleUnsub: (() => void) | undefined
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    setLoading(true)

    const [currentRecap] = getRecapSignal(sessionID)
    const previousRecap = currentRecap()

    try {
      if (optionsError) {
        throw new Error(optionsError)
      }

      // Fetch only the most recent messages
      const messagesResult = await client.session.messages({ sessionID })
      const messages = (messagesResult.data ?? []).slice(-RECENT_MESSAGES)

      const transcript = messages
        .map((m: any) => {
          const role = m.info?.role ?? "unknown"
          const text = (m.parts ?? [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text ?? "")
            .join(" ")
            .trim()
          return text ? `${role}: ${text}` : null
        })
        .filter(Boolean)
        .join("\n\n")

      if (!transcript) {
        setRecap("*Nothing to summarize yet.*")
        return
      }

      const modelToUse = configuredRecapModel ?? inferSessionModel(messages)

      // Create a throwaway session for the LLM call.
      // Model selection is applied on session.prompt via `model`, not session.create.
      const newSession = await client.session.create({})
      recapSessionID = newSession.data?.id
      if (!recapSessionID) throw new Error("Failed to create recap session")

      const prompt = `You are a summarization assistant. Output only Markdown - no tools, no files, no questions.

Summarize this coding session in ~40 words across these sections:

**Working on:** one sentence - what is being built or explored
**Done:** max 2 bullets, <=6 words each (skip if nothing yet)
**Next:** max 1 bullet - the immediate next step (skip if none)

No intro, no outro, no extra sections. Output only the Markdown.
${previousRecap ? `\nPREVIOUS RECAP (context for earlier history):\n${previousRecap}\n` : ""}
RECENT TRANSCRIPT (last ${RECENT_MESSAGES} messages):
${transcript}`

      const timeoutPromise = new Promise<never>((_, reject) =>
        timeoutHandle = setTimeout(() => reject(new Error("Recap timed out")), 30_000)
      )

      // session.prompt fires the request; wait for session to go idle, then fetch messages
      const idlePromise = new Promise<void>((resolve) => {
        idleUnsub = api.event.on("session.idle", (e: any) => {
          if (e.properties?.sessionID === recapSessionID) {
            idleUnsub?.()
            idleUnsub = undefined
            resolve()
          }
        })
      })

      await client.session.prompt({
        sessionID: recapSessionID,
        ...(modelToUse ? { model: modelToUse } : {}),
        parts: [{ type: "text", text: prompt }],
      })

      await Promise.race([idlePromise, timeoutPromise])

      // Fetch completed messages to get the assistant's reply
      const recapMessages = await client.session.messages({ sessionID: recapSessionID })
      const allMessages = recapMessages.data ?? []

      const lastAssistantMsg = [...allMessages]
        .reverse()
        .find((m: any) => {
          const role = m.info?.role ?? m.role
          if (role !== "assistant") return false
          // Exclude messages that contain the prompt we sent (echoed back as assistant)
          const text = (m.parts ?? [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text ?? "")
            .join("")
          return !text.includes("You are a summarization assistant")
        })

      const recapText = (lastAssistantMsg?.parts ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text ?? "")
        .join("")
        .trim()

      setRecap(recapText || "*No summary generated.*")
      promptCounters.set(sessionID, 0)

    } catch (err: any) {
      setRecap(`*Error: ${err?.message ?? String(err)}*`)
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      if (idleUnsub) {
        idleUnsub()
        idleUnsub = undefined
      }
      if (recapSessionID) {
        await client.session.delete({ sessionID: recapSessionID }).catch(() => {})
      }
      setLoading(false)
    }
  }

  slots.register({
    order: 300,
    slots: {
      sidebar_content(_ctx, props) {
        return (
          <View
            api={api}
            session_id={props.session_id}
            onRecap={() => generateRecap(props.session_id)}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "streetturtle.recap",
  tui,
}

export default plugin
