import { describe, expect, it } from "vitest";
import { Semaphore } from "../src/core/semaphore";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Semaphore（A2 全局并发信号量）", () => {
  it("超过 limit 的 acquire 排队，release 后按 FIFO 槽位转移放行", async () => {
    const sem = new Semaphore(() => 2);
    const order: string[] = [];
    void sem.acquire().then(() => order.push("a"));
    void sem.acquire().then(() => order.push("b"));
    const third = sem.acquire().then(() => order.push("c"));
    await tick();
    expect(sem.inFlight).toBe(2);
    expect(order).toEqual(["a", "b"]);
    sem.release(); // a 归还 → 槽位转移给队首 c（active 不变，任何时序不超限）
    await third;
    expect(order).toEqual(["a", "b", "c"]);
    expect(sem.inFlight).toBe(2); // b 与 c 仍占用
    sem.release();
    sem.release();
    expect(sem.inFlight).toBe(0);
  });

  it("动态调小 limit：在途不中断，等待者按旧槽位陆续放行后收敛到新上限", async () => {
    let limit = 3;
    const sem = new Semaphore(() => limit);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    expect(sem.inFlight).toBe(3);
    limit = 1; // 设置热调小
    const fourth = sem.acquire();
    await tick();
    expect(sem.inFlight).toBe(3); // 未超限，第四个在排队
    sem.release();
    await fourth;
    expect(sem.inFlight).toBe(3); // 槽位转移，仍 3 在途（旧持有者自然收敛）
    sem.release();
    sem.release();
    sem.release(); // 共 4 个持有者（a/b/c/fourth），第 4 次释放才归零
    expect(sem.inFlight).toBe(0);
  });

  it("无等待者时 release 释放计数，可继续 acquire", async () => {
    const sem = new Semaphore(() => 1);
    await sem.acquire();
    sem.release();
    await sem.acquire();
    expect(sem.inFlight).toBe(1);
    sem.release();
  });

  it("并发实战形态：N 个任务峰值不超过 limit 且全部完成", async () => {
    let inFlight = 0;
    let peak = 0;
    const sem = new Semaphore(() => 3);
    const task = async (): Promise<void> => {
      await sem.acquire();
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      await tick();
      inFlight--;
      sem.release();
    };
    await Promise.all(Array.from({ length: 10 }, () => task()));
    expect(peak).toBe(3);
    expect(sem.inFlight).toBe(0);
  });
});
