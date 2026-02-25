import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiDelete } from "@/lib/api";

export function useDeletePredictions(datasetId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (runName: string) =>
      apiDelete(`/datasets/${datasetId}/predictions/${encodeURIComponent(runName)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      qc.invalidateQueries({ queryKey: ["filter-facets", datasetId] });
      qc.invalidateQueries({ queryKey: ["annotations-batch"] });
      qc.invalidateQueries({ queryKey: ["evaluation"] });
      qc.invalidateQueries({ queryKey: ["statistics"] });
      qc.invalidateQueries({ queryKey: ["embedding-coordinates", datasetId] });
    },
  });
}
