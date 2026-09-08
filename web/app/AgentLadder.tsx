/** Four segments, filled to the agent's current level. Also used on Overview. */
export function AgentLadder({ level, maxLevel }: { level: number; maxLevel: number }) {
  return (
    <div className="ladder" aria-label={`Level ${level} of ${maxLevel}`}>
      {Array.from({ length: maxLevel }, (_, i) => (
        <div key={i} className={i < level ? "seg filled" : "seg"} />
      ))}
    </div>
  );
}
