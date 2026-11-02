//! Monterey capture backend. Keep the RDP, input and NSPasteboard paths upstream.
use super::*;
use anyhow::{bail, Context};
use std::collections::VecDeque;

unsafe extern "C" {
    fn macrdp_monterey_capture(
        display: u32,
        width: u32,
        height: u32,
        out: *mut u8,
        length: usize,
        letterbox: i32,
    ) -> i32;
}

pub(super) struct LegacyUpdates {
    width: u16,
    height: u16,
    display: u32,
    frame: Vec<u8>,
    previous: Vec<u8>,
    seeded: bool,
    pending: VecDeque<DisplayUpdate>,
    cursor: CursorState,
    timer: tokio::time::Interval,
    letterbox: bool,
    size: SharedDesktopSize,
    resize: PendingResize,
    suppress_adopt: Arc<AtomicBool>,
    suppressed: Option<Arc<AtomicBool>>,
}

impl LegacyUpdates {
    pub(super) fn new(config: &CaptureDisplay, width: u16, height: u16) -> Result<Self> {
        anyhow::ensure!(
            width > 0 && height > 0,
            "capture dimensions must be nonzero"
        );
        let display = config
            .display_id
            .unwrap_or(core_graphics::display::CGDisplay::main().id);
        let native = core_graphics::display::CGDisplay::new(display);
        let mode = native.display_mode().context("no active display mode")?;
        let (_, letterbox) = capture_scaling_mode(
            (mode.width() as u16, mode.height() as u16),
            (
                u16::try_from(mode.pixel_width())?,
                u16::try_from(mode.pixel_height())?,
            ),
            (width, height),
            config.auto_size,
            config.stretch,
        );
        config.desktop_size.set_letterbox(letterbox);
        let bytes = usize::from(width) * usize::from(height) * 4;
        if let Some(flag) = &config.display_suppressed {
            flag.store(false, Ordering::Relaxed);
        }
        let mut timer = tokio::time::interval(Duration::from_secs_f64(
            1.0 / f64::from(config.fps.clamp(1, 60)),
        ));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        Ok(Self {
            width,
            height,
            display,
            frame: vec![0; bytes],
            previous: vec![0; bytes],
            seeded: false,
            pending: VecDeque::new(),
            cursor: CursorState::new(width, height, config.screen_size_pts, config.cursor_scale)?,
            timer,
            letterbox,
            size: config.desktop_size.clone(),
            resize: config.pending_resize.clone(),
            suppress_adopt: config.suppress_next_adopt.clone(),
            suppressed: config.display_suppressed.clone(),
        })
    }
}

// Compare bounded tiles and transmit only changed regions. Split large updates
// using the upstream strip limit so Guacamole/FreeRDP never receive oversized PDUs.
fn changed_tiles(
    current: &[u8],
    previous: &[u8],
    width: u16,
    height: u16,
    seeded: bool,
) -> Vec<(u16, u16, u16, u16)> {
    let stride = usize::from(width) * 4;
    let mut rectangles = Vec::new();
    for y in (0..height).step_by(64) {
        for x in (0..width).step_by(128) {
            let w = 128.min(width - x);
            let h = 64.min(height - y);
            let changed = !seeded
                || (y..y + h).any(|row| {
                    let start = usize::from(row) * stride + usize::from(x) * 4;
                    let end = start + usize::from(w) * 4;
                    current[start..end] != previous[start..end]
                });
            if changed {
                rectangles.push((x, y, w, h));
            }
        }
    }
    rectangles
}

#[async_trait::async_trait]
impl RdpServerDisplayUpdates for LegacyUpdates {
    async fn next_update(&mut self) -> Result<Option<DisplayUpdate>> {
        loop {
            if let Some(update) = self.pending.pop_front() {
                return Ok(Some(update));
            }
            self.timer.tick().await;
            if let Some((width, height)) = self.resize.take_settled(RESIZE_DEBOUNCE) {
                self.size.set(width, height);
                self.suppress_adopt.store(true, Ordering::Relaxed);
                return Ok(Some(DisplayUpdate::Resize(DesktopSize { width, height })));
            }
            if self
                .suppressed
                .as_ref()
                .is_some_and(|f| f.load(Ordering::Relaxed))
            {
                self.seeded = false; // re-send a full frame after resuming
                continue;
            }
            // SAFETY: the C function writes at most length bytes into this owned
            // buffer, retains no pointers, and checks the supplied dimensions.
            let ok = unsafe {
                macrdp_monterey_capture(
                    self.display,
                    self.width.into(),
                    self.height.into(),
                    self.frame.as_mut_ptr(),
                    self.frame.len(),
                    self.letterbox.into(),
                )
            };
            if ok == 0 {
                bail!("CoreGraphics capture failed: grant Screen Recording, log in locally and restart macrdp");
            }
            self.pending.extend(self.cursor.poll());
            let stride = usize::from(self.width) * 4;
            for (x, y, w, h) in changed_tiles(
                &self.frame,
                &self.previous,
                self.width,
                self.height,
                self.seeded,
            ) {
                for (x, y, w, h) in split_strips(x, y, w, h) {
                    let mut data = Vec::with_capacity(usize::from(w) * usize::from(h) * 4);
                    for row in y..y + h {
                        let start = usize::from(row) * stride + usize::from(x) * 4;
                        data.extend_from_slice(&self.frame[start..start + usize::from(w) * 4]);
                    }
                    self.pending.push_back(DisplayUpdate::Bitmap(BitmapUpdate {
                        x,
                        y,
                        width: NonZeroU16::new(w).unwrap(),
                        height: NonZeroU16::new(h).unwrap(),
                        format: PixelFormat::BgrA32,
                        data: Bytes::from(data),
                        stride: NonZeroUsize::new(usize::from(w) * 4).unwrap(),
                    }));
                }
            }
            std::mem::swap(&mut self.frame, &mut self.previous);
            self.seeded = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seeds_edges_then_sends_only_the_changed_tile() {
        let mut frame = vec![0; 130 * 65 * 4];
        let old = frame.clone();
        assert_eq!(
            changed_tiles(&frame, &old, 130, 65, false),
            vec![
                (0, 0, 128, 64),
                (128, 0, 2, 64),
                (0, 64, 128, 1),
                (128, 64, 2, 1)
            ]
        );
        assert!(changed_tiles(&frame, &old, 130, 65, true).is_empty());
        frame[(64 * 130 + 129) * 4] = 255;
        assert_eq!(
            changed_tiles(&frame, &old, 130, 65, true),
            vec![(128, 64, 2, 1)]
        );
    }
}
