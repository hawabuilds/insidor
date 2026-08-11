# @insidor/platform-replay

A source backed by recorded JSON. It ships alongside the first real adapter, not after it: a port
with one implementation is secretly shaped like that implementation, and this is the second one.

It is also what lets `eval/` be forbidden from importing `adapters/` — a replay that can reach the
network is not a replay.

## What breaks here

- **Returning nothing for an unrecorded id.** It throws `TapeMiss` instead. A silent miss makes a
  rotting recording invisible, and the test still passes.
- **Filtering the tape by the discovery query.** A tape is the answer to the query that produced
  it. Re-filtering changes what is being replayed without saying so.
- **Zero-filling exhausted readings.** An item that stops answering is a real state; a zeroed
  counter set is an item that lost all its engagement.
- **Declaring capabilities in code.** They come off the recording, so a replay cannot claim a
  capability the recorded source did not have.
