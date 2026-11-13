// Stream mode (?stream): this Loft window is drawn by the PC's graphics card for a phone.
// the room's picture (the canvas) and its sound (never played on the PC's speakers) over the
// home Wi-Fi with WebRTC. The hand-off goes through the door: a phone asks to join, this page
// offers, the phone answers. No outside servers; everything stays in the house.
const DOOR = 'http://127.0.0.1:8060/rtc';
const peers = new Map();

export function startStream(canvas, audio) {
  const video = canvas.captureStream(60).getVideoTracks()[0];
  const sound = audio.streamOut.stream.getAudioTracks()[0];
  const tick = async () => {
    try {
      const { joins = [], answers = {} } = await (await fetch(`${DOOR}/pc`)).json();
      for (const id of joins) offer(id, video, sound);
      for (const [id, sdp] of Object.entries(answers)) {
        const pc = peers.get(id);
        if (pc && !pc.remoteDescription) await pc.setRemoteDescription({ type: 'answer', sdp });
      }
    } catch { /* (the door is closed: try again) */ }
  };
  setInterval(tick, 500);
}

async function offer(id, video, sound) {
  const pc = new RTCPeerConnection({ iceServers: [] });   // (home Wi-Fi only: no outside helper servers)
  peers.set(id, pc);
  const vs = pc.addTrack(video), ss = pc.addTrack(sound);
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) { pc.close(); peers.delete(id); } };   // (a brief 'disconnected' is normal while it settles: wait)
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === 'complete') r(); else { pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 1500); } });
  try {   // sharp and smooth: up to 12 Mb/s of picture, the music at a high rate
    const p = vs.getParameters(); p.encodings = [{ maxBitrate: 12_000_000, maxFramerate: 60 }]; p.degradationPreference = 'maintain-resolution'; await vs.setParameters(p);
    const a = ss.getParameters(); a.encodings = [{ maxBitrate: 256_000 }]; await ss.setParameters(a);
  } catch { /* (some browsers want this after connecting; the defaults are fine) */ }
  await fetch(`${DOOR}/offer`, { method: 'POST', body: JSON.stringify({ id, sdp: pc.localDescription.sdp }) });
}
