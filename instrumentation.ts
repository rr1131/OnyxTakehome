import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = () => {
  // Messages, stacks, URLs, and request headers can contain credentials.
  console.error("[server] An unexpected request error occurred.");
};
