import * as React from "react";
import { cn } from "@/lib/utils";

const mk = (name: string, base: string) => {
  const C = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
    <div ref={ref} data-slot={name} className={cn(base, className)} {...props} />
  ));
  C.displayName = name;
  return C;
};

const Card = mk("card", "bg-card text-card-foreground flex flex-col gap-6 rounded-lg border py-6 shadow-sm");
const CardHeader = mk("card-header", "grid auto-rows-min items-start gap-1.5 px-6");
const CardTitle = mk("card-title", "leading-none font-semibold");
const CardDescription = mk("card-description", "text-muted-foreground text-sm");
const CardContent = mk("card-content", "px-6");
const CardFooter = mk("card-footer", "flex items-center px-6");

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
