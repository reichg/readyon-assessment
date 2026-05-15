import { Injectable } from "@nestjs/common";

@Injectable()
export class ApprovalConcurrencyGate {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(
    employeeId: string,
    locationId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = buildApprovalKey(employeeId, locationId);
    const previousTail = this.tails.get(key) ?? Promise.resolve();
    const release = createDeferred<void>();
    const currentTail = previousTail
      .catch(() => undefined)
      .then(() => release.promise);

    this.tails.set(key, currentTail);

    await previousTail.catch(() => undefined);

    try {
      return await work();
    } finally {
      release.resolve();

      if (this.tails.get(key) === currentTail) {
        this.tails.delete(key);
      }
    }
  }
}

function buildApprovalKey(employeeId: string, locationId: string): string {
  return `${employeeId}::${locationId}`;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
