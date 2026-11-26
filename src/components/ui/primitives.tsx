import type { ComponentProps, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Flower2, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { APP_NAME } from "@/lib/branding";

export function cn(...values: ClassValue[]) { return twMerge(clsx(values)); }

const buttonStyles = cva("button", {
  variants: {
    variant: { primary: "button-primary", secondary: "button-secondary", ghost: "button-ghost", danger: "button-danger" },
    size: { normal: "button-normal", small: "button-small", icon: "button-icon" },
  },
  defaultVariants: { variant: "primary", size: "normal" },
});
type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonStyles> & { asChild?: boolean };

export function Button({ asChild, variant, size, className, type = "button", ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component {...props} type={asChild ? undefined : type} className={cn(buttonStyles({ variant, size }), className)} />;
}

export function Field({ label, help, children, className }: { label: string; help?: string; children: ReactNode; className?: string }) {
  return <label className={cn("field", className)}><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
export function Input(props: ComponentProps<"input">) { return <input {...props} className={cn("input", props.className)} />; }
export function Select(props: ComponentProps<"select">) { return <select {...props} className={cn("input select", props.className)} />; }
export function Textarea(props: ComponentProps<"textarea">) { return <textarea rows={3} {...props} className={cn("input textarea", props.className)} />; }
export function Check({ children, ...props }: ComponentProps<"input"> & { children: ReactNode }) {
  return <label className="check"><input {...props} type="checkbox" /><span>{children}</span></label>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={"badge badge-" + tone}>{children}</span>;
}
export function Brand({ logo, name = APP_NAME, compact, subtitle }: { logo?: string | null; name?: string; compact?: boolean; subtitle?: string }) {
  return <div className="brand">
    <span className="brand-mark">{logo ? <Image src={logo} alt="" width={42} height={42} unoptimized /> : <Flower2 size={24} strokeWidth={1.65} />}</span>
    {!compact && <span className="brand-type"><strong>{name}</strong>{subtitle && <small>{subtitle}</small>}</span>}
  </div>;
}
export function PageTitle({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="title-actions">{children}</div>}</div>;
}
export function SectionTitle({ icon: Icon, title, description, children }: { icon?: LucideIcon; title: string; description?: string; children?: ReactNode }) {
  return <div className="section-title"><div className="section-heading">{Icon && <span className="section-icon"><Icon size={18} /></span>}<div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>{children}</div>;
}
export function Empty({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description?: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon size={23} strokeWidth={1.6} /></span><h3>{title}</h3>{description && <p>{description}</p>}{children}</div>;
}
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return <div className="table-wrap"><table aria-label={label}>{children}</table></div>;
}
