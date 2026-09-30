interface SidebarSectionHeaderProps {
  title: string;
  badge?: string;
  badgeLabel?: string;
}

/** Quiet section label used between sidebar groups. */
export function SidebarSectionHeader({
  title,
  badge,
  badgeLabel,
}: SidebarSectionHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-4 text-xs font-medium text-text-tertiary">
      <span>{title}</span>
      {badge && (
        <span className="font-mono text-accent" aria-label={badgeLabel}>
          {badge}
        </span>
      )}
    </div>
  );
}
