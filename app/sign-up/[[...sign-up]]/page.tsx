import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <section className="auth-page" aria-label="Sign up">
      <SignUp />
    </section>
  );
}
