/**
 * VerificationPoller — checks registration status on an interval until the
 * email is verified, the link expires, or we give up.
 *
 * Features:
 *  - visible countdown ("Next check in 3s") via onTick
 *  - checks immediately when the tab regains focus (the user is probably
 *    coming back from their email app)
 *  - backs off after network errors instead of hammering the server
 *  - stops after `timeoutMin` so an abandoned tab doesn't poll forever
 *
 * Usage:
 *   const poller = createVerificationPoller({ registrationId, intervalSec, timeoutMin, onTick, onResult, onError, onTimeout });
 *   poller.start();  ...  poller.stop();
 */
import { registrationService } from './registrationService.js';

const MAX_BACKOFF_SEC = 30;

export function createVerificationPoller({
  registrationId,
  intervalSec,
  timeoutMin,
  onTick = () => {},
  onResult = () => {},
  onError = () => {},
  onTimeout = () => {},
}) {
  let timer = null;
  let secondsLeft = intervalSec;
  let checks = 0;
  let failures = 0;
  let inFlight = false;
  let deadline = 0;

  const emitTick = () => onTick({ checks, nextCheckInSec: secondsLeft, inFlight });

  async function check() {
    if (inFlight) return;
    inFlight = true;
    emitTick();
    try {
      const result = await registrationService.getStatus(registrationId);
      checks += 1;
      failures = 0;
      secondsLeft = intervalSec;
      if (result.status !== 'PENDING') {
        stop();
        onResult(result); // VERIFIED or EXPIRED
        return;
      }
    } catch (err) {
      failures += 1;
      // A 4xx means this registration is gone for good; don't keep retrying.
      if (err.status >= 400 && err.status < 500 && err.status !== 429) {
        stop();
        onError(err, { fatal: true });
        return;
      }
      secondsLeft = Math.min(intervalSec * 2 ** failures, MAX_BACKOFF_SEC);
      onError(err, { fatal: false });
    } finally {
      inFlight = false;
    }
    if (timer) emitTick();
  }

  function tick() {
    if (Date.now() > deadline) {
      stop();
      onTimeout();
      return;
    }
    if (inFlight) return;
    secondsLeft -= 1;
    if (secondsLeft <= 0) check();
    else emitTick();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && timer) check();
  }

  function start() {
    stop();
    deadline = Date.now() + timeoutMin * 60 * 1000;
    secondsLeft = intervalSec;
    timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    check(); // check right away rather than waiting a full interval
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return { start, stop, checkNow: check };
}
