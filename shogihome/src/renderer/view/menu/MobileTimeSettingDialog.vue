<template>
  <div class="dialog-mask" @click.self="onCancel">
    <dialog ref="dialog" class="time-dialog">
      <div class="title">{{ t.timeLimit }}</div>
      <div class="content">
        <div class="input-grid">
          <div class="input-group">
            <div class="label">{{ t.allottedTime }} ({{ t.minutesSuffix }})</div>
            <div class="stepper">
              <button class="step-btn" @click="updateTime('timeSeconds', -600)">-10</button>
              <button class="step-btn" @click="updateTime('timeSeconds', -60)">-1</button>
              <div class="value-box">{{ Math.floor(tempSettings.timeSeconds / 60) }}</div>
              <button class="step-btn" @click="updateTime('timeSeconds', 60)">+1</button>
              <button class="step-btn" @click="updateTime('timeSeconds', 600)">+10</button>
            </div>
          </div>
          <div class="input-group">
            <div class="label">{{ t.byoyomi }} ({{ t.secondsSuffix }})</div>
            <div class="stepper">
              <button class="step-btn" @click="updateTime('byoyomi', -10)">-10</button>
              <button class="step-btn" @click="updateTime('byoyomi', -1)">-1</button>
              <div class="value-box">{{ tempSettings.byoyomi }}</div>
              <button class="step-btn" @click="updateTime('byoyomi', 1)">+1</button>
              <button class="step-btn" @click="updateTime('byoyomi', 10)">+10</button>
            </div>
          </div>
          <div class="input-group">
            <div class="label">{{ t.increments }} ({{ t.secondsSuffix }})</div>
            <div class="stepper">
              <button class="step-btn" @click="updateTime('increment', -10)">-10</button>
              <button class="step-btn" @click="updateTime('increment', -1)">-1</button>
              <div class="value-box">{{ tempSettings.increment }}</div>
              <button class="step-btn" @click="updateTime('increment', 1)">+1</button>
              <button class="step-btn" @click="updateTime('increment', 10)">+10</button>
            </div>
          </div>
        </div>
      </div>
      <div class="main-buttons">
        <button class="start" @click="onOk">{{ t.ok }}</button>
        <button class="cancel" @click="onCancel">{{ t.cancel }}</button>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { t } from "@/common/i18n";
import { TimeLimitSettings } from "@/common/settings/game";
import { ref, onMounted } from "vue";
import { showModalDialog } from "@/renderer/helpers/dialog";

const props = defineProps<{
  initialSettings: TimeLimitSettings;
}>();

const emit = defineEmits<{
  ok: [settings: TimeLimitSettings];
  cancel: [];
}>();

const dialog = ref<HTMLDialogElement>();
const tempSettings = ref<TimeLimitSettings>({ ...props.initialSettings });

onMounted(() => {
  if (dialog.value) {
    showModalDialog(dialog.value, onCancel);
  }
});

const updateTime = (key: keyof TimeLimitSettings, delta: number) => {
  let newValue = tempSettings.value[key] + delta;
  if (newValue < 0) newValue = 0;
  tempSettings.value[key] = newValue;

  if (key === "byoyomi" && newValue > 0) {
    tempSettings.value.increment = 0;
  } else if (key === "increment" && newValue > 0) {
    tempSettings.value.byoyomi = 0;
  }
};

const onOk = () => {
  emit("ok", { ...tempSettings.value });
};

const onCancel = () => {
  emit("cancel");
};
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100dvh;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 110;
}
.time-dialog {
  width: 88vw;
  max-width: 380px;
  background-color: var(--selector-bg-color);
  border: 1px solid var(--dialog-border-color);
  border-radius: 4px;
  padding: 0;
  display: flex;
  flex-direction: column;
  color: var(--selector-color);
}
.title {
  font-size: 1.1em;
  font-weight: bold;
  padding: 12px;
  text-align: center;
  border-bottom: 1px solid var(--text-separator-color);
}
.content {
  padding: 15px;
}
.input-grid {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.input-group .label {
  font-size: 0.8em;
  color: var(--selector-color);
  opacity: 0.8;
  margin-bottom: 6px;
}
.stepper {
  display: flex;
  align-items: stretch;
  background-color: var(--selector-bg-color);
}
.step-btn {
  width: 42px;
  height: 40px;
  border: none;
  background-color: var(--control-button-bg-color);
  color: var(--control-button-color);
  padding: 0;
  font-size: 0.9em;
  cursor: pointer;
}
.step-btn:active {
  opacity: 0.8;
}
.value-box {
  flex: 1;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--selector-bg-color);
  color: var(--selector-color);
  font-size: 1.2em;
  font-weight: bold;
}
.main-buttons {
  display: flex;
  padding: 10px;
  gap: 10px;
  border-top: 1px solid var(--text-separator-color);
}
.main-buttons button {
  flex: 1;
  padding: 12px;
  font-weight: bold;
  border: 1px solid var(--dialog-border-color);
  background-color: var(--control-button-bg-color);
  color: var(--control-button-color);
  border-radius: 0;
  cursor: pointer;
}
.main-buttons button.start {
  background-color: var(--pushed-selector-bg-color);
  color: var(--pushed-selector-color);
}
.main-buttons button:active {
  opacity: 0.8;
}
</style>
