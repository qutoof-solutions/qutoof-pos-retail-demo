import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-teal text-white shadow-sm hover:bg-teal/90",
      destructive: "bg-red-600 text-white hover:bg-red-700",
      outline: "border border-slate-200 bg-white text-navy hover:bg-slate-50",
      secondary: "bg-slate-100 text-navy hover:bg-slate-200",
      ghost: "text-navy hover:bg-slate-100",
      link: "text-teal underline-offset-4 hover:underline",
    },
    size: { default: "h-11 px-5 py-2", sm: "h-9 rounded-lg px-3", lg: "h-12 rounded-xl px-7 text-base", icon: "size-10" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
Button.displayName = "Button";
export { buttonVariants };
