<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-900">Deployments</h2>
      <button
        @click="refresh"
        class="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
      >
        <RefreshCw class="w-4 h-4" />
        Refresh
      </button>
    </div>

    <div v-if="store.deployments.length === 0 && !store.loading" class="text-center py-12 text-gray-400">
      <Boxes class="w-12 h-12 mx-auto mb-3 text-gray-300" />
      <p>No deployments registered</p>
      <p class="text-xs mt-1">Run deploy_flows.py on Windows Agent</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="dep in store.deployments"
        :key="dep.id"
        class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow"
      >
        <!-- Header -->
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="font-semibold text-gray-900">{{ dep.name }}</h3>
            <p class="text-xs text-gray-400 font-mono mt-0.5">{{ dep.id?.slice(0, 12) }}</p>
          </div>
          <span
            class="px-2 py-1 rounded text-xs font-medium"
            :class="dep.is_schedule_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'"
          >
            {{ dep.is_schedule_active ? 'Scheduled' : 'Manual' }}
          </span>
        </div>

        <!-- Info -->
        <div class="space-y-2 mb-4">
          <div class="flex items-center gap-2 text-sm text-gray-600" v-if="dep.work_pool_name">
            <Server class="w-4 h-4 text-gray-400" />
            {{ dep.work_pool_name }}
          </div>
          <div class="flex items-center gap-2 text-sm text-gray-600" v-if="dep.schedule?.cron">
            <Clock class="w-4 h-4 text-gray-400" />
            {{ dep.schedule.cron }}
          </div>
          <div class="flex flex-wrap gap-1" v-if="dep.tags?.length">
            <span
              v-for="tag in dep.tags"
              :key="tag"
              class="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded"
            >{{ tag }}</span>
          </div>
        </div>

        <!-- Trigger Button -->
        <button
          @click="triggerDeployment(dep)"
          :disabled="triggering === dep.id"
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Play class="w-4 h-4" />
          {{ triggering === dep.id ? 'Triggering...' : 'Trigger Now' }}
        </button>
      </div>
    </div>

    <!-- Trigger Success/Error Toast -->
    <div
      v-if="toast.show"
      class="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all"
      :class="toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { RefreshCw, Boxes, Play, Server, Clock } from 'lucide-vue-next'
import { useJobsStore } from '../stores/jobs'

const store = useJobsStore()
const triggering = ref(null)
const toast = reactive({ show: false, message: '', type: 'success' })

function showToast(message, type = 'success') {
  toast.show = true
  toast.message = message
  toast.type = type
  setTimeout(() => { toast.show = false }, 3000)
}

async function triggerDeployment(dep) {
  triggering.value = dep.id
  try {
    const result = await store.triggerJob(dep.name)
    showToast(`Job triggered: ${result.flow_run_id.slice(0, 8)}`, 'success')
  } catch (e) {
    showToast(`Failed: ${e.message}`, 'error')
  } finally {
    triggering.value = null
  }
}

function refresh() {
  store.fetchDeployments()
}

onMounted(() => {
  store.fetchDeployments()
})
</script>
