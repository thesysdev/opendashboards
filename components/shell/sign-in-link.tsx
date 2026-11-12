import { Button } from "@/components/ui/button";
import { SIGN_IN_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Where the user would be, for a signed-out visitor. */
export function SignInLink({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={cn(className)}>
      <a href={SIGN_IN_URL} rel="nofollow">
        Sign in
      </a>
    </Button>
  );
}
