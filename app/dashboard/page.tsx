import { auth } from "@clerk/nextjs/server";
import MarketBrowser from "@/components/market-browser";

export default async function DashboardPage() {
  const { userId } = await auth.protect();

  return (
    <section className="panel">
      <h1>Dashboard</h1>
      <p className="page-intro">Live market prices. Virtual cash. Track your paper portfolio below.</p>
      <MarketBrowser key={userId} />
    </section>
  );
}
