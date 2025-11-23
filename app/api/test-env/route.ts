import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "✅ Set (length: " + process.env.GEMINI_API_KEY.length + ")" : "❌ Not set",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Not set",
    NODE_ENV: process.env.NODE_ENV,
  });
}
