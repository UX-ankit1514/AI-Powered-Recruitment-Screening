import { handleCreateBatch } from "@/lib/ingest/batches";

export async function POST(req: Request) {
  return handleCreateBatch(req);
}
