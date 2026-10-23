import * as React from "react";
import { toast } from "sonner";
import {
  Activity, BookOpen, Boxes, KeyRound, LogOut, Monitor, Moon, Package, RefreshCw, ShieldCheck, Sun, User, Users,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, clearToken, getToken, go, redirectForStatus, setCsrf, setToken } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type TabId = "status" | "catalog" | "installs" | "harnesses" | "audit" | "operators";
const TABS: { id: TabId; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "status", label: "Status", description: "Version, paths and detected harnesses.", icon: Activity },
  { id: "catalog", label: "Catalog", description: "Search the skill catalog.", icon: BookOpen },
  { id: "installs", label: "Installs", description: "Install from a catalog id, path, or git URL.", icon: Package },
  { id: "harnesses", label: "Harnesses", description: "Known agent harnesses on this host.", icon: Boxes },
  { id: "audit", label: "Audit", description: "Audit a source and review recent events.", icon: ShieldCheck },
  { id: "operators", label: "Operators", description: "Local to this skill-flow instance.", icon: Users },
];

type Report = (msg: string) => void;

function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList, onErr: Report) {
  const [data, setData] = React.useState<T | null>(null);
  const reload = React.useCallback(() => {
    fn().then(setData).catch((e: Error) => onErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  React.useEffect(() => reload(), [reload]);
  return [data, reload] as const;
}

function Loading() {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-6 w-1/3" />
    </div>
  );
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-muted-foreground">{text}</TableCell>
    </TableRow>
  );
}

type StatusRes = { version?: string; skillFlowHome?: string; catalogDir?: string; harnessesPresent?: string[] };
function StatusTab({ onErr }: { onErr: Report }) {
  const [st] = useLoad(() => api<StatusRes>("/v1/status"), [], onErr);
  if (!st) return <Loading />;
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">Version</dt><dd className="font-mono">{st.version}</dd>
      <dt className="text-muted-foreground">Home</dt><dd className="font-mono break-all">{st.skillFlowHome}</dd>
      <dt className="text-muted-foreground">Catalog</dt><dd className="font-mono break-all">{st.catalogDir}</dd>
      <dt className="text-muted-foreground">Harnesses</dt>
      <dd className="flex flex-wrap gap-1">
        {(st.harnessesPresent || []).length
          ? st.harnessesPresent!.map((h) => <Badge key={h} variant="secondary">{h}</Badge>)
          : <span className="text-muted-foreground">none detected</span>}
      </dd>
    </dl>
  );
}

function CatalogTab({ onErr }: { onErr: Report }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ name: string; summary?: string }[] | null>(null);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ results?: { name: string; summary?: string }[] }>(`/v1/catalog/search?q=${encodeURIComponent(q)}`);
      setResults(r.results || []);
    } catch (err) {
      onErr((err as Error).message);
    }
  }
  return (
    <div className="grid gap-4">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <Input name="q" placeholder="search skills" aria-label="Search skills" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button type="submit">Search</Button>
      </form>
      {results ? (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Summary</TableHead></TableRow></TableHeader>
          <TableBody>
            {results.length ? results.map((r) => (
              <TableRow key={r.name}><TableCell className="font-mono">{r.name}</TableCell><TableCell>{r.summary}</TableCell></TableRow>
            )) : <Empty cols={2} text="No hits" />}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}

function InstallsTab({ onErr }: { onErr: Report }) {
  const [data, reload] = useLoad(() => api<{ installed?: { name: string; path: string }[] }>("/v1/installs"), [], onErr);
  const [source, setSource] = React.useState("");
  async function install(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/v1/installs", { method: "POST", body: JSON.stringify({ source }) });
      toast.success("Installed");
      setSource("");
      reload();
    } catch (err) {
      onErr((err as Error).message);
    }
  }
  async function uninstall(name: string) {
    try {
      await api(`/v1/installs/${encodeURIComponent(name)}`, { method: "DELETE" });
      toast.success(`Uninstalled ${name}`);
      reload();
    } catch (err) {
      onErr((err as Error).message);
    }
  }
  return (
    <div className="grid gap-4">
      <form onSubmit={install} className="flex flex-wrap gap-2">
        <Input name="source" required placeholder="catalog id, path, or git URL" aria-label="Install source" value={source} onChange={(e) => setSource(e.target.value)} className="max-w-md" />
        <Button type="submit">Install</Button>
      </form>
      {!data ? <Loading /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Path</TableHead><TableHead className="w-0" /></TableRow></TableHeader>
          <TableBody>
            {(data.installed || []).length ? data.installed!.map((i) => (
              <TableRow key={i.name}>
                <TableCell>{i.name}</TableCell>
                <TableCell className="font-mono text-xs break-all">{i.path}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="outline" size="sm">Uninstall</Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Uninstall {i.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This removes the skill from {i.path}.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void uninstall(i.name)}>Uninstall</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            )) : <Empty cols={3} text="None" />}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

type Harness = { id: string; present?: boolean };
function HarnessesTab({ onErr }: { onErr: Report }) {
  const [data] = useLoad(() => api<{ registry?: Harness[]; detected?: Harness[] }>("/v1/harnesses"), [], onErr);
  if (!data) return <Loading />;
  const rows = data.detected || data.registry || [];
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Id</TableHead><TableHead>Present</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length ? rows.map((h) => (
          <TableRow key={h.id}>
            <TableCell className="font-mono">{h.id}</TableCell>
            <TableCell><Badge variant={h.present ? "default" : "outline"}>{h.present ? "yes" : "no"}</Badge></TableCell>
          </TableRow>
        )) : <Empty cols={2} text="None" />}
      </TableBody>
    </Table>
  );
}

function AuditTab({ onErr, onInfo }: { onErr: Report; onInfo: Report }) {
  const [data, reload] = useLoad(() => api<{ events?: { ts: string; action: string }[] }>("/v1/audit/events"), [], onErr);
  const [source, setSource] = React.useState("");
  async function run(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ report?: { risk?: string } }>("/v1/audit", { method: "POST", body: JSON.stringify({ source }) });
      if (r.report) onInfo(`risk ${r.report.risk}`);
      reload();
    } catch (err) {
      onErr((err as Error).message);
    }
  }
  return (
    <div className="grid gap-4">
      <form onSubmit={run} className="flex flex-wrap gap-2">
        <Input name="source" required placeholder="source to audit" aria-label="Source to audit" value={source} onChange={(e) => setSource(e.target.value)} className="max-w-md" />
        <Button type="submit">Run audit</Button>
      </form>
      {!data ? <Loading /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data.events || []).length ? data.events!.map((ev, idx) => (
              <TableRow key={`${ev.ts}-${idx}`}>
                <TableCell className="text-muted-foreground font-mono text-xs">{ev.ts}</TableCell>
                <TableCell>{ev.action}</TableCell>
              </TableRow>
            )) : <Empty cols={2} text="No events" />}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function OperatorsTab({ onErr }: { onErr: Report }) {
  const [data, reload] = useLoad(() => api<{ operators?: { email: string }[] }>("/v1/operators"), [], onErr);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/v1/operators", { method: "POST", body: JSON.stringify({ email, password }) });
      toast.success(`Added ${email}`);
      setEmail("");
      setPassword("");
      reload();
    } catch (err) {
      onErr((err as Error).message);
    }
  }
  return (
    <div className="grid gap-4">
      {!data ? <Loading /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Email</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data.operators || []).length
              ? data.operators!.map((o) => <TableRow key={o.email}><TableCell>{o.email}</TableCell></TableRow>)
              : <Empty cols={1} text="None" />}
          </TableBody>
        </Table>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input name="email" type="email" required placeholder="email" aria-label="New operator email" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
        <Input name="password" type="password" minLength={8} required placeholder="password (8+)" aria-label="New operator password" value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-xs" />
        <Button type="submit">Add</Button>
      </form>
    </div>
  );
}

function BreakGlass({ onSave }: { onSave: () => void }) {
  const [value, setValue] = React.useState(getToken());
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <KeyRound className="size-4" /> Break-glass token
      </summary>
      <form
        className="mt-2 grid gap-2 px-2"
        onSubmit={(e) => {
          e.preventDefault();
          setToken(value.trim());
          onSave();
        }}
      >
        <Label htmlFor="token" className="sr-only">Admin token</Label>
        <Input id="token" type="password" placeholder="Admin token" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" size="sm">Save</Button>
      </form>
    </details>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme"><Icon /></Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConsolePage() {
  const [who, setWho] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>("status");
  const [nonce, setNonce] = React.useState(0);
  const [message, setMessage] = React.useState<{ kind: "error" | "info"; text: string } | null>(null);

  const onErr = React.useCallback((text: string) => {
    if (text === "unauthorized") return;
    setMessage({ kind: "error", text });
    toast.error(text);
  }, []);
  const onInfo = React.useCallback((text: string) => {
    setMessage({ kind: "info", text });
    toast(text);
  }, []);
  const refresh = React.useCallback(() => {
    setMessage(null);
    setNonce((n) => n + 1);
  }, []);

  React.useEffect(() => {
    void (async () => {
      const me = await fetch("/v1/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (me?.operator) {
        setCsrf(me.csrf || "");
        setWho(me.operator.email);
        return;
      }
      if (getToken()) {
        setWho("Break-glass token");
        return;
      }
      await redirectForStatus();
    })();
  }, []);

  async function signOut() {
    clearToken();
    await fetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    go("login");
  }

  const current = TABS.find((t) => t.id === tab)!;
  const panelKey = `${tab}-${nonce}`;

  return (
    <div className="bg-background flex min-h-svh flex-col md:flex-row">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col gap-2 border-b p-3 md:sticky md:top-0 md:h-svh md:w-64 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex h-10 items-center px-2"><Brand /></div>
        <nav aria-label="Console sections" className="flex gap-1 overflow-x-auto md:flex-col">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => { setTab(t.id); setMessage(null); }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                tab === t.id && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden md:block">
          <Separator className="my-2" />
          <BreakGlass onSave={() => { if (!who) setWho("Break-glass token"); refresh(); }} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">Operator console · skill plane</p>
            <h1 className="truncate text-sm font-medium">{current.label}</h1>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Refresh" onClick={refresh}><RefreshCw /></Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <ThemeMenu />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="User menu"><User /> <span className="hidden max-w-40 truncate sm:inline">{who ?? "…"}</span></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="truncate">{who}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Catalog, audit, install with confirm.</h2>
            <p className="text-muted-foreground text-sm">Search, audit, and install SKILL.md packages into any harness.</p>
          </div>
          {message ? (
            <p role={message.kind === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", message.kind === "error" ? "border-destructive/50 text-destructive" : "text-foreground")}>
              {message.text}
            </p>
          ) : null}
          <div className="md:hidden"><BreakGlass onSave={() => { if (!who) setWho("Break-glass token"); refresh(); }} /></div>
          <Card>
            <CardHeader>
              <CardTitle>{current.label}</CardTitle>
              <CardDescription>{current.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {who === null ? <Loading /> : (
                <React.Fragment key={panelKey}>
                  {tab === "status" && <StatusTab onErr={onErr} />}
                  {tab === "catalog" && <CatalogTab onErr={onErr} />}
                  {tab === "installs" && <InstallsTab onErr={onErr} />}
                  {tab === "harnesses" && <HarnessesTab onErr={onErr} />}
                  {tab === "audit" && <AuditTab onErr={onErr} onInfo={onInfo} />}
                  {tab === "operators" && <OperatorsTab onErr={onErr} />}
                </React.Fragment>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
