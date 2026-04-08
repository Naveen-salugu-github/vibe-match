"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { moderateMessage } from "@/lib/moderation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Send, Loader2 } from "lucide-react";

export type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type ChatInterfaceProps = {
  matchId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
};

export function ChatInterface({
  matchId,
  currentUserId,
  initialMessages,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingHide = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const channel = supabase
      .channel(`match-room:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row].sort(
              (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        }
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const uid = (payload as { userId?: string })?.userId;
        if (uid && uid !== currentUserId) {
          setPeerTyping(true);
          if (typingHide.current) clearTimeout(typingHide.current);
          typingHide.current = setTimeout(() => setPeerTyping(false), 2000);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (typingHide.current) clearTimeout(typingHide.current);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId, supabase, currentUserId]);

  const broadcastTyping = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUserId },
    });
  }, [currentUserId]);

  const send = useCallback(async () => {
    const m = moderateMessage(input);
    if (!m.ok) {
      setWarn(m.reason);
      return;
    }
    setWarn(null);
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: matchId, content: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWarn(data.error ?? "Could not send");
        return;
      }
      setInput("");
    } finally {
      setSending(false);
    }
  }, [input, matchId]);

  const onInputChange = (v: string) => {
    setInput(v);
    if (v.length > 0) broadcastTyping();
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3 pr-2">
          {messages.map((msg) => {
            const mine = msg.sender_id === currentUserId;
            return (
              <div
                key={msg.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-lg",
                    mine
                      ? "bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white"
                      : "border border-white/10 bg-white/10 text-white/95"
                  )}
                >
                  {msg.content}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      {warn && (
        <p className="mx-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Heads up: for everyone&apos;s safety we keep contact details off-platform. {warn}
        </p>
      )}
      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <Input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Keep it fun — no contact info"
          className="flex-1"
          disabled={sending}
        />
        <Button type="button" size="icon" onClick={() => void send()} disabled={sending}>
          {sending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
      <p className="px-4 pb-3 text-center text-[11px] text-violet-200/80">
        {peerTyping ? "Match is typing…" : "Trust layer on: contact details are auto-filtered."}
      </p>
    </div>
  );
}
