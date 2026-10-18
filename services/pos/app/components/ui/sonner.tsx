import { useTheme } from "next-themes";
import { useLocation } from "react-router";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const managedByCaos = useLocation().pathname === "/master-sheet";

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className={managedByCaos ? "hidden" : "toaster group"}
      style={managedByCaos ? { display: "none" } : undefined}
      duration={managedByCaos ? Number.POSITIVE_INFINITY : undefined}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
