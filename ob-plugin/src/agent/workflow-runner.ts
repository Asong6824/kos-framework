export interface IsolatedWorkflowClient {
  newSession(): Promise<{ cancelled: boolean }>;
  setSessionName(name: string): Promise<void>;
  prompt(message: string): Promise<void>;
}

export interface IsolatedWorkflowRequest {
  message: string;
  sessionName: string;
}

export async function runIsolatedAgentWorkflow(
  client: IsolatedWorkflowClient,
  request: IsolatedWorkflowRequest,
  onSessionReady: () => Promise<void> = async () => {},
): Promise<void> {
  const result = await client.newSession();
  if (result.cancelled) throw new Error('当前 Agent 任务尚未结束，无法启动新的看板工作流');
  await client.setSessionName(request.sessionName);
  await onSessionReady();
  await client.prompt(request.message);
}
