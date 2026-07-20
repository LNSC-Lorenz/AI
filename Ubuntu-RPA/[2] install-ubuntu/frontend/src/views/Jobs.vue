<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-900">Jobs</h2>
      <div class="flex items-center gap-3">
        <!-- Status Filter -->
        <select
          v-model="filter"
          class="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="ALL">All Status</option>
          <option value="RUNNING">Running</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="PENDING">Pending</option>
          <option value="SCHEDULED">Scheduled</option>
        </select>
        <!-- Refresh -->
        <button
          @click="refresh"
          class="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          :disabled="store.loading"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />
          Refresh
        </button>
      </div>
    </div>

    <!-- Job Cards -->
    <div v-if="store.loading && store.jobs.length === 0" class="text-center py-12 text-gray-400">Loading...</div>
    <div v-else-if="filteredJobs.length === 0" class="text-center py-12 text-gray-400">
      <Inbox class="w-12 h-12 mx-auto mb-3 text-gray-300" />
      <p>No jobs found</p>
    </div>

    <div v-else class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs font-medium text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
            <th class="px-5 py-3">Job Name</th>
            <th class="px-5 py-3">Flow</th>
            <th class="px-5 py-3">Status</th>
            <th class="px-5 py-3">Tags</th>
            <th class="px-5 py-3">Started</th>
            <th class="px-5 py-3">Duration</th>
            <th class="px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="job in filteredJobs"
            :key="job.id"
            class="hover:bg-blue-50/50 transition-colors"
          >
            <td class="px-5 py-3.5">
              <router-link :to="`/jobs/${job.id}`" class="font-medium text-blue-600 hover:text-blue-800 text-sm">
                {{ job.name || job.id.slice(0, 8) }}
              </router-link>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-600">
              {{ job.flow_id?.slice(0, 8) || '-' }}
            </td>
            <td class="px-5 py-3.5">
              <StatusBadge :status="job.state?.type || 'PENDING'" />
            </td>
            <td class="px-5 py-3.5">
              <span
                v-for="tag in (job.tags || []).slice(0, 3)"
                :key="tag"
                class="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded mr-1"
              >{{ tag }}</span>
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-500">
              {{ formatTime(job.start_time || job.expected_start_time) }}
            </td>
            <td class="px-5 py-3.5 text-sm text-gray-500">
              {{ formatDuration(job.start_time, job.end_time) }}
            </td>
            <td class="px-5 py-3.5">
              <button
                @click.stop="$router.push(`/jobs/${job.id}`)"
                class="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Details
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
