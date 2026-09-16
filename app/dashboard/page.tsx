import { auth } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  const { userId } = await auth.protect();

  return (
    <section className="panel">
      <h1>Dashboard</h1>
      <p>You are signed in. Welcome to your paper-trading dashboard.</p>
      <p className="auth-state">User ID: {userId}</p>
    </section>
  );
}
