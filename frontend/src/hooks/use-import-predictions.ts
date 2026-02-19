import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiPost } from "@/lib/api";
import type {
  PredictionImportRequest,
  PredictionImportResponse,
} from "@/types/prediction";

export function useImportPredictions(datasetId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body: PredictionImportRequest) =>
      apiPost<PredictionImportResponse>(
        `/datasets/${datasetId}/predictions`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      qc.invalidateQueries({ queryKey: ["filter-facets", datasetId] });
      qc.invalidateQueries({ queryKey: ["annotations-batch"] });
      qc.invalidateQueries({ queryKey: ["embedding-coordinates", datasetId] });
    },
  });
}
