import type { Message, Part, Session } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiCommand, TuiPluginModule } from "@opencode-ai/plugin/tui"

const COMMAND_NAME = "execute-plan"
const COMMAND_TITLE = "/execute-plan"
const COMMAND_DESCRIPTION = "Ask for a final plan, then start a fresh session from that plan only"

function getTextFromPart(part: Part): string {
  return part.type === "text" ? part.text.trim() : ""
}

function getMessageText(message: Message): string {
  return message.parts.map(getTextFromPart).filter(Boolean).join("\n").trim()
}

function buildExecutionPrompt(plan: string, extraInstructions: string): string {
  const extra = extraInstructions.trim()
  return [
    "Execute this plan.",
    "You only have the plan below, not the prior planning conversation.",
    extra ? `Additional instructions: ${extra}` : undefined,
    "## Plan",
    plan,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildFinalizePlanPrompt(extraInstructions: string): string {
  const extra = extraInstructions.trim()
  return [
    "Provide the final implementation plan for this task.",
    extra ? `Additional instructions for the plan: ${extra}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n")
}

async function getSession(
  client: Parameters<TuiPlugin>[0]["client"],
  sessionID: string,
  directory?: string,
): Promise<Session> {
  const result = await client.session.get({ sessionID, directory }, { throwOnError: true })
  return result.data
}

async function createSession(
  client: Parameters<TuiPlugin>[0]["client"],
  options: {
    directory?: string
    parentID?: string
    title?: string
    workspaceID?: string
  },
): Promise<Session> {
  const { directory, parentID, title, workspaceID } = options
  const result = await client.session.create({ directory, parentID, title, workspaceID }, { throwOnError: true })
  return result.data
}

async function waitForAssistantReply(
  client: Parameters<TuiPlugin>[0]["client"],
  sessionID: string,
  previousAssistantCount: number,
  directory?: string,
): Promise<string> {
  const timeoutMs = 10 * 60 * 1000
  const pollMs = 1000
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await client.session.messages({ sessionID, directory }, { throwOnError: true })
    const messages = result.data ?? []
    const assistantMessages = messages.filter((message) => message.role === "assistant")

    if (assistantMessages.length > previousAssistantCount) {
      const latest = assistantMessages[assistantMessages.length - 1]
      const text = getMessageText(latest)
      if (text && latest.time.completed) return text
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error("Timed out waiting for the assistant to produce the final plan")
}

export const tui: TuiPlugin = async (api) => {
  const run = async (rawArguments = "") => {
    const route = api.route.current
    if (route.name !== "session") {
      api.ui.toast({
        variant: "warning",
        message: "Open a session before running /execute-plan.",
      })
      return
    }

    const sessionID = route.params.sessionID
    const directory = api.state.path.directory

    try {
      const currentSession = await getSession(api.client, sessionID, directory)
      const currentMessages = await api.client.session.messages({ sessionID, directory }, { throwOnError: true })
      const previousAssistantCount = (currentMessages.data ?? []).filter((message) => message.role === "assistant").length

      api.ui.toast({
        variant: "info",
        message: "Requesting a final consolidated plan from the current session.",
      })

      await api.client.session.prompt(
        {
          sessionID,
          directory,
          agent: "plan",
          parts: [{ type: "text", text: buildFinalizePlanPrompt(rawArguments) }],
        },
        { throwOnError: true },
      )

      const plan = await waitForAssistantReply(api.client, sessionID, previousAssistantCount, directory)
      const nextSession = await createSession(api.client, {
        directory,
        parentID: currentSession.id,
        title: "Execute finalized plan",
        workspaceID: currentSession.workspaceID,
      })
      void api.client.session
        .prompt({
          sessionID: nextSession.id,
          directory,
          agent: "build",
          parts: [{ type: "text", text: buildExecutionPrompt(plan, rawArguments) }],
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          api.ui.toast({
            variant: "error",
            message: `Failed to hand off finalized plan: ${message}`,
          })
        })

      setTimeout(() => {
        api.route.navigate("session", { sessionID: nextSession.id })
      }, 50)
      api.ui.toast({
        variant: "success",
        message: "Started a fresh session from a finalized plan.",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      api.ui.toast({
        variant: "error",
        message: `Failed to execute plan: ${message}`,
      })
    }
  }

  api.command.register(
    (): TuiCommand[] => [
      {
        title: COMMAND_TITLE,
        value: COMMAND_NAME,
        description: COMMAND_DESCRIPTION,
        category: "Session",
        suggested: true,
        slash: { name: COMMAND_NAME },
        onSelect: () => {
          api.ui.dialog.replace(() =>
            api.ui.DialogPrompt({
              title: COMMAND_TITLE,
              placeholder: "Optional extra instructions",
              onConfirm: (value) => {
                api.ui.dialog.clear()
                void run(value)
              },
              onCancel: () => api.ui.dialog.clear(),
            }),
          )
        },
      },
    ],
  )

  api.event.on("tui.command.execute", (event) => {
    if (event.properties.command !== COMMAND_NAME) return
    void run("")
  })
}

export default {
  id: "execute-plan",
  tui,
} satisfies TuiPluginModule
