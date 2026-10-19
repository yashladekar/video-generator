"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronRight,
  CircleDollarSign,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Plus,
  Send,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

import { Button } from "@video-generator/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@video-generator/ui/components/dropdown-menu";
import { Skeleton } from "@video-generator/ui/components/skeleton";
import { cn } from "@video-generator/ui/lib/utils";

import { Brand } from "@/components/brand";
import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import { Badge, Progress } from "@/components/ui/primitives";
import { formatInr, percent, timeAgo } from "@/lib/format";
import { trpc } from "@/utils/trpc";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create", label: "Create Reel", icon: Sparkles },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/publishing", label: "Publishing", icon: Send },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

type NavHref = (typeof NAV)[number]["href"];

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: NavHref;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-foreground bg-sidebar-accent text-foreground"
          : "border-transparent text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      {active ? <ChevronRight className="size-3.5" /> : null}
    </Link>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const budget = useQuery(trpc.budget.get.queryOptions());
  const budgetData = budget.data;
  const used = budgetData
    ? budgetData.spentInrPaise + budgetData.reservedInrPaise
    : 0;
  const usedPercent = budgetData
    ? percent(used, budgetData.amountInrPaise)
    : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <Brand />
      </div>
      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          render={<Link href="/create" onClick={onNavigate} />}
        >
          <Plus className="size-4" />
          Create New Reel
        </Button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname === item.href || pathname.startsWith(`${item.href}/`)
            }
            onClick={onNavigate}
          />
        ))}
      </nav>
      <div className="mt-auto space-y-3 p-3">
        <Link
          href="/settings?tab=budget"
          onClick={onNavigate}
          className="block border border-sidebar-border bg-sidebar-accent/40 p-3 transition-colors hover:bg-sidebar-accent"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <CircleDollarSign className="size-3.5" />
              Monthly budget
            </span>
            {budgetData?.settings.localOnly ? (
              <Badge variant="info">Local</Badge>
            ) : null}
          </div>
          {budget.isLoading ? (
            <Skeleton className="mt-2 h-8 w-full" />
          ) : budgetData ? (
            <>
              <div className="mt-2 flex items-baseline justify-between text-xs">
                <span className="font-semibold">
                  {formatInr(budgetData.spentInrPaise)} spent
                </span>
                <span className="text-muted-foreground">
                  of {formatInr(budgetData.amountInrPaise)}
                </span>
              </div>
              <Progress
                value={usedPercent}
                className="mt-2 bg-sidebar-border"
                indicatorClassName={usedPercent > 85 ? "bg-red-500" : undefined}
              />
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {formatInr(budgetData.spendableInrPaise)} available for new jobs
              </div>
            </>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Set up your budget
            </div>
          )}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <UserMenu />
          <ModeToggle />
        </div>
      </div>
    </div>
  );
}

function NotificationsMenu() {
  const queryClient = useQueryClient();
  const notifications = useQuery(
    trpc.notifications.list.queryOptions({ unreadOnly: true }),
  );
  const markAll = useMutation(
    trpc.notifications.markAllRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.notifications.list.queryKey({ unreadOnly: true }),
        });
      },
    }),
  );
  const items = notifications.data ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <span className="relative">
          <Bell className="size-4" />
          {items.length > 0 ? (
            <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
              {items.length > 9 ? "9+" : items.length}
            </span>
          ) : null}
        </span>
        <span className="sr-only">Notifications</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Notifications
            {items.length > 0 ? (
              <button
                type="button"
                className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                onClick={() => markAll.mutate()}
              >
                Mark all read
              </button>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            items.slice(0, 6).map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className="flex flex-col items-start gap-1 py-2"
                onClick={() =>
                  window.location.assign(notification.link ?? "/dashboard")
                }
              >
                <span className="text-xs font-medium">{notification.title}</span>
                {notification.body ? (
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">
                    {notification.body}
                  </span>
                ) : null}
                <span className="text-[10px] text-muted-foreground">
                  {timeAgo(notification.createdAt)}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isStudio = pathname.startsWith("/studio/");

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-sidebar-border bg-sidebar">
            <div className="absolute right-2 top-3">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span>Workspace</span>
            <ChevronRight className="size-3" />
            <span className="text-foreground">
              {NAV.find((item) =>
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href),
              )?.label ?? "ReelForge"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              className="hidden gap-1.5 sm:inline-flex"
              render={<Link href="/create" />}
            >
              <Plus className="size-3.5" />
              New Reel
            </Button>
            <NotificationsMenu />
            <div className="hidden sm:block">
              <ModeToggle />
            </div>
          </div>
        </header>

        <main
          className={cn(
            isStudio
              ? "min-h-[calc(100svh-3.5rem)]"
              : "mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
