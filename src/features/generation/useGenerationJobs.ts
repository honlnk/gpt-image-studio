import { computed, ref } from "vue";
import { createId } from "../../shared/id";
import type { GenerationJob } from "./generationJobTypes";

export function useGenerationJobs(activeConversationId: { value: string }) {
  const jobs = ref<GenerationJob[]>([]);

  const pendingJobCount = computed(
    () => jobs.value.filter((job) => job.status === "pending").length,
  );
  const isGenerating = computed(() => pendingJobCount.value > 0);
  const activeConversationPendingJobs = computed(() =>
    jobs.value.filter(
      (job) =>
        job.status === "pending" &&
        job.conversationId === activeConversationId.value,
    ),
  );
  const pendingJobCountByConversation = computed(() => {
    const counts: Record<string, number> = {};
    jobs.value.forEach((job) => {
      if (job.status !== "pending") return;
      counts[job.conversationId] = (counts[job.conversationId] ?? 0) + 1;
    });
    return counts;
  });

  function createJob(
    input: Omit<GenerationJob, "id" | "status" | "startedAtMs">,
  ): GenerationJob {
    const job: GenerationJob = {
      id: createId("job"),
      status: "pending",
      startedAtMs: Date.now(),
      ...input,
    };
    jobs.value.push(job);
    return job;
  }

  function markJobSuccess(jobId: string) {
    const job = jobs.value.find((item) => item.id === jobId);
    if (!job) return;
    job.status = "success";
    job.finishedAtMs = Date.now();
    job.errorMessage = undefined;
  }

  function markJobError(jobId: string, errorMessage: string) {
    const job = jobs.value.find((item) => item.id === jobId);
    if (!job) return;
    job.status = "error";
    job.finishedAtMs = Date.now();
    job.errorMessage = errorMessage;
  }

  return {
    activeConversationPendingJobs,
    createJob,
    isGenerating,
    jobs,
    markJobError,
    markJobSuccess,
    pendingJobCountByConversation,
    pendingJobCount,
  };
}
