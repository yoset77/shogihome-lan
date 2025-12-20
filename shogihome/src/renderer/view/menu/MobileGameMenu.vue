<template>
  <div>
    <dialog ref="dialog" class="menu">
      <!-- Header -->
      <div class="group">
        <button data-hotkey="Escape" class="close" @click="onClose">
          <Icon :icon="IconType.CLOSE" />
          <div class="label">{{ t.back }}</div>
        </button>
      </div>

      <!-- Player Selection -->
      <div v-if="currentView === 'selectPlayer'" class="group">
        <button @click="selectPlayer(uri.ES_BASIC_ENGINE_STATIC_ROOK_V1)">
          <Icon :icon="IconType.ROBOT" />
          <div class="label">{{ `${t.beginner} (${t.staticRook})` }}</div>
        </button>
        <button @click="selectPlayer(uri.ES_BASIC_ENGINE_RANGING_ROOK_V1)">
          <Icon :icon="IconType.ROBOT" />
          <div class="label">{{ `${t.beginner} (${t.rangingRook})` }}</div>
        </button>
        <template v-if="lanEngineList.length > 0">
          <button
            v-for="info in lanEngineList.filter(
              (e) => !e.type || e.type === 'game' || e.type === 'both',
            )"
            :key="info.id"
            @click="selectPlayer(`lan-engine:${info.id}`, info.name)"
          >
            <Icon :icon="IconType.ROBOT" />
            <div class="label">LAN: {{ info.name }}</div>
          </button>
        </template>
        <button v-else @click="selectPlayer('lan-engine')">
          <Icon :icon="IconType.ROBOT" />
          <div class="label">LAN Engine</div>
        </button>
      </div>

      <!-- Position Selection -->
      <div v-if="currentView === 'selectPosition'" class="group">
        <button @click="selectStartPosition(InitialPositionType.STANDARD)">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.noHandicap }}</div>
        </button>
        <button @click="selectStartPosition('current')">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.beginFromThisPosition }}</div>
        </button>
      </div>

      <!-- Turn Selection -->
      <div v-if="currentView === 'selectTurn'" class="group">
        <button @click="selectTurn(Color.BLACK)">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.sente }}</div>
        </button>
        <button @click="selectTurn(Color.WHITE)">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.gote }}</div>
        </button>
        <button @click="selectTurn(Math.random() * 2 >= 1 ? Color.BLACK : Color.WHITE)">
          <Icon :icon="IconType.GAME" />
          <div class="label">{{ t.pieceToss }}</div>
        </button>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { t } from "@/common/i18n";
import { JishogiRule } from "@/common/settings/game";
import * as uri from "@/common/uri";
import Icon from "@/renderer/view/primitive/Icon.vue";
import { IconType } from "@/renderer/assets/icons";
import { installHotKeyForDialog, uninstallHotKeyForDialog } from "@/renderer/devices/hotkey";
import { showModalDialog } from "@/renderer/helpers/dialog";
import { useStore } from "@/renderer/store";
import { Color, InitialPositionType } from "tsshogi";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { lanEngine, LanEngineInfo } from "@/renderer/network/lan_engine";

type View = "selectPlayer" | "selectPosition" | "selectTurn";

const store = useStore();
const dialog = ref();
const currentView = ref<View>("selectPlayer");
const playerURI = ref("");
const playerName = ref("");
const startPosition = ref<InitialPositionType | "current">(InitialPositionType.STANDARD);
const lanEngineList = ref<LanEngineInfo[]>([]);

const emit = defineEmits<{
  close: [];
}>();

const onClose = () => {
  emit("close");
};

onMounted(async () => {
  showModalDialog(dialog.value, onClose);
  installHotKeyForDialog(dialog.value);
  try {
    lanEngineList.value = await lanEngine.getEngineList();
  } catch (e) {
    console.error(e);
  }
});

onBeforeUnmount(() => {
  uninstallHotKeyForDialog(dialog.value);
});

const selectPlayer = (uri: string, name?: string) => {
  playerURI.value = uri;
  playerName.value = name || "";
  currentView.value = "selectPosition";
};

const selectStartPosition = (position: InitialPositionType | "current") => {
  startPosition.value = position;
  currentView.value = "selectTurn";
};

const selectTurn = (turn: Color) => {
  let black = { name: t.human, uri: uri.ES_HUMAN };
  let name = playerName.value;
  if (!name) {
    if (playerURI.value === "lan-engine") {
      name = "LAN Engine";
    } else if (playerURI.value.startsWith("lan-engine:")) {
      name = `LAN: ${playerURI.value.split(":")[1]}`;
    } else {
      name = uri.basicEngineName(playerURI.value);
    }
  }
  let white = {
    name: name,
    uri: playerURI.value,
  };
  if (turn === Color.WHITE) {
    [black, white] = [white, black];
  }
  store.startGame({
    black,
    white,
    timeLimit: {
      timeSeconds: 900,
      byoyomi: 60,
      increment: 0,
    },
    startPosition: startPosition.value,
    startPositionListFile: "",
    startPositionListOrder: "sequential",
    enableEngineTimeout: false,
    humanIsFront: true,
    enableComment: false,
    enableAutoSave: false,
    repeat: 1,
    swapPlayers: false,
    maxMoves: 1000,
    jishogiRule: JishogiRule.NONE,
  });
  emit("close");
};
</script>
