/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { SyntaxStyle } from "@opentui/core"

// Module-level signals so the View component reacts to changes
const recapSignals = new Map<string, ReturnType<typeof createSignal<string | null>>>()
const loadingSignals = new Map<string, ReturnType<typeof createSignal<boolean>>>()

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
        onMouseDown={() => { if (!loading()) props.onRecap() }}
      >
        {loading() ? "Generating…" : "Generate Recap"}
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

const tui: TuiPlugin = async (api) => {
  const { slots, client } = api

  async function generateRecap(sessionID: string) {
    const [, setRecap] = getRecapSignal(sessionID)
    const [, setLoading] = getLoadingSignal(sessionID)

    setLoading(true)

    try {
      // Fetch messages snapshot for the current session
      const messagesResult = await client.session.messages({ sessionID })
      const messages = messagesResult.data ?? []

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

      // Create a throwaway session for the LLM call
      const newSession = await client.session.create({})
      const recapSessionID = newSession.data?.id
      if (!recapSessionID) throw new Error("Failed to create recap session")

      const prompt = `Summarize this coding session in Markdown. Be extremely terse — sidebar space is limited.

**TL;DR:** one sentence.
**Done:** max 3 bullets, ≤8 words each.
**Changed:** \`file\` — one phrase (skip if none).
**Next:** max 2 bullets (skip if none).

No intro, no outro, no extra sections. Output only the Markdown.

TRANSCRIPT:
${transcript}`

      const result = await client.session.prompt({
        sessionID: recapSessionID,
        parts: [{ type: "text", text: prompt }],
      })

      const recapText = (result.data?.parts ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => (p as any).text ?? "")
        .join("")
        .trim()

      setRecap(recapText || "*No summary generated.*")

      // Clean up throwaway session
      await client.session.delete({ sessionID: recapSessionID }).catch(() => {})
    } catch (err: any) {
      setRecap(`*Error: ${err?.message ?? String(err)}*`)
    } finally {
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
  id: "recap",
  tui,
}

export default plugin
