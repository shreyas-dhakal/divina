import type { HostToOverlay, OverlayToHost } from "../../src/shared/protocol.ts";

function send(msg: OverlayToHost) {
  window.parent.postMessage(msg, "*");
}

window.addEventListener("message", (e: MessageEvent<HostToOverlay>) => {
  // stub: handled by the overlay task
  void e.data;
});

send({ type: "ready", url: location.href });
