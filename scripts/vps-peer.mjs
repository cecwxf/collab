// Bundled by esbuild and run through SSH. Config and fresh test room key arrive on stdin.
import { createInterface } from "node:readline";
import { hostname } from "node:os";
import { generateIdentity } from "@collab/protocol";
import { CollabClient, WsTransport } from "@collab/sdk";

const input = createInterface({ input: process.stdin });
const config = JSON.parse(await new Promise((resolve) => input.once("line", resolve)));
const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const transport = new WsTransport(config.url);
const client = new CollabClient({ identity: await generateIdentity(config.agentId), roomId: config.roomId, roomKey: config.roomKey, transport, reconnect: true });
const work = new Set();
client.onStatus((status) => output({ kind: "status", status }));
client.onPayload((payload) => {
  if (!client.shouldWake(payload)) return;
  const run = (async () => {
    if (payload.kind === "chat") {
      await client.streamReply(`stream-${payload.messageId}`, ["VPS received: ", payload.text], payload.messageId);
    } else if (payload.kind === "task.create") {
      await client.claimTask(payload.taskId);
      await client.updateTask(payload.taskId, "done", "Verified by the client running on the VPS");
    }
  })();
  work.add(run);
  run.catch((e) => output({ kind: "error", message: e.message })).finally(() => work.delete(run));
});
input.once("close", () => { void client.dispose().finally(() => process.exit(0)); });
input.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.kind === "disconnect") transport.ws?.close(1000, "integration-disconnect");
  if (command.kind === "stop") void (async () => {
    await Promise.allSettled(work);
    await client.dispose();
    input.close();
    process.exit(0);
  })();
});
try {
  await client.join();
  output({ kind: "ready", host: hostname(), node: process.version });
} catch (e) {
  output({ kind: "error", message: e.message });
  await client.dispose();
  process.exit(1);
}
