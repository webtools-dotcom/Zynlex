import { useRef, type CSSProperties, type ReactElement } from "react";
import { List } from "react-window";

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  className?: string;
  overscanCount?: number;
  children: (props: { index: number; style: CSSProperties; item: T }) => ReactElement | null;
}

export function VirtualList<T>({
  items,
  itemHeight,
  className,
  overscanCount = 5,
  children,
}: VirtualListProps<T>) {
  const itemsRef = useRef(items);
  itemsRef.current = items;

  if (items.length === 0) return null;

  return (
    <List
      className={className}
      rowCount={items.length}
      rowHeight={itemHeight}
      style={{ height: "100%", width: "100%" } as CSSProperties}
      overscanCount={overscanCount}
      rowComponent={({ index, style }) => {
        const item = itemsRef.current[index];
        if (!item) return null;
        return children({ index, style, item });
      }}
      rowProps={{} as any}
    />
  );
}
