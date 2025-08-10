"use client";

import React from "react";

export function Header() {
  const [name, setName] = React.useState<string>("Studio Canvas");
  const [isEditing, setIsEditing] = React.useState(false);

  return (
    <header className="h-16 border-b flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <span className="font-semibold">FloraFauna Studio</span>
        <span className="text-xs text-foreground/60">MVP</span>
        <div className="w-px h-5 bg-foreground/10" />
        {isEditing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setIsEditing(false);
              if (e.key === "Escape") setIsEditing(false);
            }}
            className="text-sm px-2 py-1 rounded border bg-transparent"
          />
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm font-medium hover:underline"
            title="Rename project"
          >
            {name}
          </button>
        )}
      </div>
      <div className="text-xs text-foreground/60">Local session</div>
    </header>
  );
}

export default Header;


