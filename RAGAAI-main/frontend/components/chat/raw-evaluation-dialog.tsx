"use client";

import { JsonView } from "@/components/common/json-view";
import { QueryError } from "@/components/common/query-error";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiQuery } from "@/hooks/use-api-query";
import { frameworkLabel } from "@/lib/evaluation";
import { getRawEvaluations } from "@/services/evaluations";

export function RawEvaluationDialog({
  messageId,
  open,
  onOpenChange,
}: {
  messageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, error, isLoading, refresh } = useApiQuery(open ? `raw-eval:${messageId}` : null, (signal) =>
    getRawEvaluations(messageId, signal),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_1fr] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Raw evaluation results</DialogTitle>
          <DialogDescription>Exact evaluator inputs and outputs, as stored by the backend.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {isLoading && <Skeleton className="h-64 w-full" />}
          {error !== undefined && <QueryError error={error} onRetry={refresh} />}
          {data && data.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No raw evaluation results are stored for this answer.</p>
          )}
          {data && data.length > 0 && (
            <Tabs defaultValue={data[0].evaluation_id}>
              <TabsList className="max-w-full overflow-x-auto">
                {data.map((r, i) => (
                  <TabsTrigger key={r.evaluation_id} value={r.evaluation_id}>
                    {frameworkLabel(r.framework)} #{i + 1}
                  </TabsTrigger>
                ))}
              </TabsList>
              {data.map((r) => (
                <TabsContent key={r.evaluation_id} value={r.evaluation_id} className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Inputs</p>
                    <JsonView value={r.inputs} maxHeight="16rem" />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Raw output</p>
                    <JsonView value={r.raw} maxHeight="22rem" />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
