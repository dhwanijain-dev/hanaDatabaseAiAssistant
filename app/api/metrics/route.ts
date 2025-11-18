import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/metrics";

// Protected metrics endpoint. Provide header x-metrics-token matching process.env.METRICS_TOKEN.
// Returns aggregate in-memory metrics; resets on serverless cold start.

export async function GET(request: Request) {
  const tokenHeader = request.headers.get("x-metrics-token");
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Metrics token not configured" }, { status: 503 });
  }
  if (tokenHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const metrics = getMetrics();
  return NextResponse.json({ metrics });
}
