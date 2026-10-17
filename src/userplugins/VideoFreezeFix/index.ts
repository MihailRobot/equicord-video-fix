/*
 * VideoFreezeFix — userplugin для Equicord/Vencord
 *
 * Чинит зависание видео в полноэкранном режиме (баг DirectComposition video
 * overlays в Chromium/ Electron на Windows):
 *
 * 1) CSS `transform: translateZ(0)` на <video> запрещает Chromium выносить
 *    видеокадр в аппаратный overlay — кадры снова идут через обычный
 *    композитор, фриз пропадает. Превью не задето, там overlay и так не юзается.
 * 2) Watchdog: если видео «играет», но currentTime стоит на месте — пинаем
 *    декодер (pause → seek → play).
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const LastTime = new WeakMap<HTMLVideoElement, number>();

const settings = definePluginSettings({
    watchdog: {
        type: OptionType.BOOLEAN,
        description: "Автоматически пинать зависшее видео (pause → seek → play)",
        default: true,
    },
    interval: {
        type: OptionType.NUMBER,
        description: "Интервал проверки watchdog, мс",
        default: 1000,
    },
});

export default definePlugin({
    name: "VideoFreezeFix",
    description:
        "Fixes frozen fullscreen videos (DirectComposition overlay bug): forces compositor rendering + auto-unfreezes stuck videos",
    authors: [{ id: 0n, name: "shpak" }], // впиши свой Discord ID вместо 0n
    settings,

    styleEl: null as HTMLStyleElement | null,
    timer: null as ReturnType<typeof setInterval> | null,

    injectCss() {
        this.styleEl?.remove();
        const el = document.createElement("style");
        el.id = "vc-video-freeze-fix";
        el.textContent = `
            /* выкидываем видео из аппаратного overlay обратно в композитор */
            video {
                transform: translateZ(0) !important;
            }
        `;
        document.head.appendChild(el);
        this.styleEl = el;
    },

    start() {
        this.injectCss();
        this.timer = setInterval(() => this.check(), settings.store.interval);
    },

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.styleEl?.remove();
        this.styleEl = null;
    },

    check() {
        if (!settings.store.watchdog) return;
        document.querySelectorAll("video").forEach(video => {
            // пропускаем: на паузе, не загрузилось, стрим/live
            if (video.paused || video.ended || video.readyState < 2) return;
            if (video.duration === Infinity || video.duration === 0) return;

            const prev = LastTime.get(video);
            const now = video.currentTime;

            // играет, но время стоит → завис, пинаем
            if (prev !== undefined && Math.abs(now - prev) < 0.01) {
                const target = Math.min(now + 0.25, video.duration - 0.1);
                video.pause();
                video.currentTime = target;
                video.play().catch(() => {});
            }

            LastTime.set(video, now);
        });
    },
});
