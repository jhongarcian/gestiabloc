import { parentPort, workerData } from "node:worker_threads"
import { extractFileText, chunkSourceText } from "./ai-source-extraction.js"
import { AiSourceError } from "./ai-source-types.js"
void (async () => {
  try {
    const pages = await extractFileText(
      workerData.filename,
      Buffer.from(workerData.bytes),
    )
    chunkSourceText(pages)
    parentPort?.postMessage({ pages })
  } catch (error) {
    parentPort?.postMessage({
      code: error instanceof AiSourceError ? error.code : "EXTRACTION_FAILED",
      error:
        error instanceof AiSourceError
          ? error.message
          : "The document is invalid or could not be read.",
    })
  }
})()
