import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// Плашка запроса на изменение (макет «Запросы агентов Mikrotik»): подкрашенный
// фон тона без рамки, жирная фраза цветом тона, пояснение основным цветом.
// Основа — ui/alert; у варианта default фона-тона нет, поэтому тон добавлен
// токенами проекта (warning / destructive), иконки нет.
const TONE = {
  warning: { box: "bg-warning/10", title: "text-warning-text" },
  success: { box: "bg-primary/10", title: "text-accent-text" },
  danger: { box: "bg-destructive/10", title: "text-destructive" },
};

const ChangeNote = ({ tone = "warning", title, children, className }) => (
  <Alert className={cn("border-transparent", TONE[tone].box, className)}>
    <AlertTitle
      className={cn("line-clamp-none font-semibold", TONE[tone].title)}
    >
      {title}
    </AlertTitle>
    {children && (
      <AlertDescription className="text-foreground">
        {children}
      </AlertDescription>
    )}
  </Alert>
);

export default ChangeNote;
