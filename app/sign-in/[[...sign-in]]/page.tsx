import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <section className="auth-page" aria-label="Sign in">
      <SignIn />
    </section>
  );
}
