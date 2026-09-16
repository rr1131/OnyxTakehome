"use client";

export default function GlobalErrorPage({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <h1>Something went wrong</h1>
        <p>Please try again.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
