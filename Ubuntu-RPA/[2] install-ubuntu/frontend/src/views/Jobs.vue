<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-lg font-semibold text-zinc-300 uppercase tracking-wider">Jobs</h2>
      <div class="flex items-center gap-3">
        <!-- Status Filter -->
        <select
          v-model="filter"
          class="px-3 py-1.5 border border-zinc-700 rounded text-sm bg-zinc-900 text-zinc-300 font-mono focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
        >
          <option value="ALL">ALL</option>
          <option value="RUNNING">RUN</option>
          <option value="COMPLETED">OK</option>
          <option value="FAILED">FAIL</option>
          <option value="PENDING">WAIT</option>
          <option value="SCHEDULED">SCHED</option>
        </select>
        <!-- Refresh -->
        <button
          @click="refresh"
          class="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          :disabled="store.loading"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': store.loading }" />
          REFRESH
        </button>
      </div>
    </div>

    <!-- Job Cards -->
    <div v-if="store.loading && store.jobs.length === 0" class="text-center py-12 text-zinc-600 font-mono text-sm">Loading...</div>
    <div v-else-if="filteredJobs.length === 0" class="text-center py-12 text-zinc-600">
      <Inbox class="w-10 h-10 mx-auto mb-3 text-zinc-700" />
      <p class="font-mono text-sm">No jobs</p>
    </div>

    <div v-else class="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs font-mono text-zinc-600 uppercase border-b border-zinc-800">
            <th class="px-5 py-2.5">Name</th>
            <th class="px-5 py-2.5">Flow</th>
            <th class="px-5 py-2.5">Status</th>
            <th class="px-5 py-2.5">Tags</th>
            <th class="px-5 py-2.5">Started</th>
            <th class="px-5 py-2.5">Duration</th>
            <th class="px-5 py-2.5"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800/50">
          <tr
            v-for="job in filteredJobs"
            :key="job.id"
            class="hover:bg-zinc-800/50 transition-colors"
          >
            <td class="px-5 py-3">
              <router-link :to="`/jobs/${job.id}`" class="font-medium text-amber-500 hover:text-amber-400 text-sm">
                {{ job.name || job.id.slice(0, 8) }}
              </router-link>
            </td>
            <td class="px-5 py-3 text-sm font-mono text-zinc-600">
              {{ job.flow_id?.slice(0, 8) || '-' }}
            </td>
            <td class="px-5 py-3">
              <StatusBadge :status="job.state?.type || 'PENDING'" />
            </td>
            <td class="px-5 py-3">
              <span
                v-for="tag in (job.tags || []).slice(0, 3)"
                :key="tag"
                class="inline-block bg-zinc-800 text-zinc-500 text-xs font-mono px-1.5 py-0.5 rounded mr-1"
              >{{ tag }}</span>
            </td>
            <td class="px-5 py-3 text-sm font-mono text-zinc-500">
              {{ formatTime(job.start_time || job.expected_start_time) }}
            </td>
            <td class="px-5 py-3 text-sm font-mono text-zinc-500">
              {{ formatDuration(job.start_time, job.end_time) }}
            </td>
            <td class="px-5 py-3">
              <button
                @click.stop="$router.push(`/jobs/${job.id}`)"
                class="text-xs font-mono text-zinc-600 hover:text-zinc-300"
              >
                &gt;
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Inbox } from 'lucide-vue-next'
import { useJobsStore } from '../stores/jobs'
import StatusBadge from '../components/StatusBadge.vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const store = useJobsStore()
const filter = ref('ALL')

const filteredJobs = computed(() => {
  if (filter.value === 'ALL') return store.jobs
  return store.jobs.filter(j => j.state?.type === filter.value)
})

function formatTime(t) {
  return t ? dayjs(t).fromNow() : '-'
}

function formatDuration(start, end) {
  if (!start) return '-'
  const s = dayjs(start)
  const e = end ? dayjs(end) : dayjs()
  const sec = e.diff(s, 'second')
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function refresh() {
  store.fetchJobs()
}

onMounted(() => {
  store.fetchJobs()
})
</script>
