import { Skeleton } from "@/components/ui/skeleton"

function TaskRowSkeleton() {
  return (
    <div className="flex gap-1 rounded-lg border bg-card p-1.5">
      <Skeleton className="aspect-video w-24 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-1">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

export function HomeBootSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="sr-only">正在加载任务</p>
      <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
      <Skeleton className="h-14 w-full shrink-0 rounded-xl" />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <TaskRowSkeleton key={index} />
        ))}
      </div>
    </div>
  )
}
