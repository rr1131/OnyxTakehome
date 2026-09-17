import { auth } from "@clerk/nextjs/server";
import { NeonDbError } from "@neondatabase/serverless";
import { getAccountState } from "@/lib/account";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return Response.json(
        { error: "Authentication required." },
        { status: 401, headers },
      );
    }

    const account = await getAccountState(userId);
    return Response.json(account, { headers });
  } catch (error) {
    // SQLSTATE is safe diagnostic context. Raw errors can include credentials,
    // query parameters, connection strings, or user information.
    const code =
      error instanceof NeonDbError && /^[0-9A-Z]{5}$/.test(error.code ?? "")
        ? error.code
        : "UNKNOWN";
    console.error("[api/account] Failed to load account state.", { code });

    return Response.json(
      { error: "Unable to load account. Please try again." },
      { status: 500, headers },
    );
  }
}
