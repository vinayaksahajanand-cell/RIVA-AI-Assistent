"use client";

import { Loader2, MoreHorizontal, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ClassificationBadge, RoleBadge } from "@/components/access/access-badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { StatusPill } from "@/components/common/status-pill";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApiQuery } from "@/hooks/use-api-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatDateTime, formatRelativeTime, initials } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import { roleLabel } from "@/lib/permissions";
import { ROLES, type MemberOut, type Role } from "@/lib/types";
import { createMember, getSecurityOverview, listMembers, removeMember, updateMember } from "@/services/admin";
import { errorMessage } from "@/services/http";

const ROLE_HINTS: Record<Role, string> = {
  admin: "Full control: users, security, all documents, audit log",
  manager: "Manages documents, analytics and evaluation",
  user: "Chat portal only, within their clearance",
};

function RoleSelect({ value, onChange, disabled, id, label }: {
  value: string;
  onChange: (role: Role) => void;
  disabled?: boolean;
  id?: string;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="h-8 w-36 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {roleLabel(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (member: MemberOut) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <CreateUserForm onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateUserForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (member: MemberOut) => void }) {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = password.length > 0 && password.length < 8;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const member = await createMember({ email: email.trim(), full_name: fullName.trim(), password, role });
      toast.success(`${member.email} added as ${roleLabel(member.role)}`);
      onCreated(member);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add a user</DialogTitle>
        <DialogDescription>Create an account in this workspace. Share the password with them securely.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-name`}>Full name</Label>
        <Input id={`${ids}-name`} value={fullName} maxLength={200} onChange={(e) => setFullName(e.target.value)} placeholder="Ada Lovelace" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-email`}>Email</Label>
        <Input
          id={`${ids}-email`}
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-password`}>Temporary password</Label>
        <Input
          id={`${ids}-password`}
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          aria-invalid={tooShort || undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className={tooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>At least 8 characters.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-role`}>Role</Label>
        <RoleSelect id={`${ids}-role`} value={role} onChange={setRole} label="Role for the new user" />
        <p className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200/70 ring-inset">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !email.trim() || password.length < 8}>
          {busy && <Loader2 className="animate-spin" />} Add user
        </Button>
      </DialogFooter>
    </form>
  );
}

/** /admin/users — workspace members, roles (→ clearance), activation and removal. Requires users.manage. */
export function UsersManager() {
  const { me } = useSession();
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 300);
  const members = useApiQuery(`admin:users:${q}`, (signal) => listMembers(q || undefined, signal), { keepPreviousData: true });
  const overview = useApiQuery("admin:security", (signal) => getSecurityOverview(signal));
  const [createOpen, setCreateOpen] = useState(false);
  const [removing, setRemoving] = useState<MemberOut | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const replace = (m: MemberOut) => members.mutate((prev) => prev?.map((x) => (x.id === m.id ? m : x)));

  async function patch(member: MemberOut, body: Parameters<typeof updateMember>[1], success: string) {
    setPending(member.id);
    try {
      replace(await updateMember(member.id, body));
      toast.success(success);
      overview.refresh();
    } catch (err) {
      notifyError(err);
    } finally {
      setPending(null);
    }
  }

  const list = members.data;

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Invite people, set their role and control access. A role determines both permissions and the highest document classification a person can retrieve."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus /> Add user
          </Button>
        }
      />

      <section aria-label="Role clearance" className="grid gap-2 sm:grid-cols-3">
        {ROLES.map((role) => {
          const info = overview.data?.roles.find((r) => r.role === role);
          return (
            <div key={role} className="rounded-xl border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <RoleBadge role={role} />
                {info ? (
                  <span className="text-[11.5px] text-muted-foreground tabular">
                    {info.members} member{info.members === 1 ? "" : "s"}
                  </span>
                ) : (
                  <Skeleton className="h-3 w-14" />
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Skeleton className="h-4 w-16" />
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{ROLE_HINTS[role]}</p>
              </div>
          );
        })}
      </section>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="h-9 pr-8 pl-8"
          aria-label="Search users"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {members.error !== undefined && !list && <QueryError error={members.error} onRetry={members.refresh} />}
      {!list && members.error === undefined && (
        <div className="space-y-2 rounded-xl border p-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}
      {list && list.length === 0 && (
        <EmptyState icon={Users} title={q ? "No users match your search" : "No users yet"} description={q ? "Try another name or email." : "Add the first user to this workspace."} />
      )}
      {list && list.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-background scrollbar-thin">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Clearance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((m) => {
                const self = m.id === me.user.id;
                const busy = pending === m.id;
                const name = m.full_name || m.email;
                return (
                  <TableRow key={m.id} className={m.is_active ? undefined : "opacity-70"}>
                    <TableCell className="max-w-[300px] pl-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                          {initials(name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {m.full_name || "—"}
                            {self && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {self ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              <RoleBadge role={m.role} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>You can&apos;t change your own role</TooltipContent>
                        </Tooltip>
                      ) : (
                        <RoleSelect
                          value={m.role}
                          disabled={busy}
                          label={`Role for ${m.email}`}
                          onChange={(role) => role !== m.role && void patch(m, { role }, `${m.email} is now ${roleLabel(role)}`)}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <ClassificationBadge value={m.clearance} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={m.is_active}
                          disabled={self || busy}
                          onCheckedChange={(v) => void patch(m, { is_active: v }, v ? `${m.email} activated` : `${m.email} deactivated`)}
                          aria-label={m.is_active ? `Deactivate ${m.email}` : `Activate ${m.email}`}
                        />
                        <StatusPill tone={m.is_active ? "success" : "neutral"}>{m.is_active ? "Active" : "Inactive"}</StatusPill>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(m.last_login_at)}>
                      {m.last_login_at ? formatRelativeTime(m.last_login_at) : "Never"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(m.created_at)}>
                      {formatDate(m.created_at)}
                    </TableCell>
                    <TableCell className="pr-4">
                      {!self && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.email}`} disabled={busy}>
                              {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                              <Trash2 /> Remove from workspace
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(member) => {
          setCreateOpen(false);
          members.mutate((prev) => (prev ? [...prev, member] : [member]));
          overview.refresh();
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove user?"
        description={`${removing?.email ?? ""} will lose access to this workspace immediately.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeMember(removing.id);
            members.mutate((prev) => prev?.filter((x) => x.id !== removing.id));
            toast.success(`${removing.email} removed`);
            overview.refresh();
          } catch (err) {
            notifyError(err);
          }
        }}
      />
    </PageContainer>
  );
}
