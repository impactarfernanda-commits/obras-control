import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";

type Props = { children: ReactNode; resetKey: string };
type State = { error: Error | null };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route content failed", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey)
      this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <RouteErrorFallback error={this.state.error} reset={() => this.setState({ error: null })} />
    );
  }
}

function RouteErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-lg rounded-lg border bg-card p-6 text-center">
      <h1 className="text-xl font-semibold">Esta tela não carregou</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        O restante do sistema continua disponível. Tente carregar esta tela novamente.
      </p>
      {import.meta.env.DEV && (
        <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-left text-xs">
          {error.name}: {error.message}
          {error.stack ? `\n${error.stack}` : ""}
        </pre>
      )}
      <div className="mt-5 flex justify-center gap-2">
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={async () => {
            await router.invalidate();
            reset();
          }}
        >
          Tentar novamente
        </button>
        <Link className="rounded-md border px-4 py-2 text-sm" to="/funcionarios">
          Ir para Funcionários
        </Link>
      </div>
    </div>
  );
}
