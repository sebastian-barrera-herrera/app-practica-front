import asyncio, time, contextvars

log = []
async def worker(name, delay, fail=False):
    print("start", name)
    await asyncio.sleep(delay)
    if fail:
        raise ValueError(name)
    print("end", name)
    return name

async def producer(q, n):
    for i in range(n):
        await q.put(i)
        print("put", i)
        await asyncio.sleep(0.1)
    await q.put(None)

async def consumer(q):
    while (item := await q.get()) is not None:
        print("got", item)
        q.task_done()

async def agen():
    for i in range(3):
        await asyncio.sleep(0.01)
        yield i

async def main():
    t0 = time.monotonic()
    print(await asyncio.gather(worker("a", 0.3), worker("b", 0.1), worker("c", 0.2)))
    print(await asyncio.gather(worker("x", 0.1), worker("y", 0.05, True), return_exceptions=True))
    try:
        await asyncio.gather(worker("p", 0.1), worker("q", 0.05, True))
    except ValueError as e:
        print("gather error", e)
    await asyncio.sleep(0.2)
    t1 = asyncio.create_task(worker("t1", 0.2), name="job")
    print(t1.get_name(), t1.done())
    await asyncio.sleep(0)
    t1.cancel()
    try:
        await t1
    except asyncio.CancelledError:
        print("cancelled", t1.cancelled())
    try:
        await asyncio.wait_for(worker("slow", 5), timeout=0.2)
    except asyncio.TimeoutError:
        print("timeout")
    q = asyncio.Queue(maxsize=2)
    await asyncio.gather(producer(q, 4), consumer(q))
    lock = asyncio.Lock()
    ev = asyncio.Event()
    sem = asyncio.Semaphore(2)
    async def locked(n):
        async with lock:
            print("lock", n)
            await asyncio.sleep(0.01)
    await asyncio.gather(*(locked(i) for i in range(3)))
    async def waiter():
        await ev.wait()
        print("event set")
    w = asyncio.create_task(waiter())
    await asyncio.sleep(0.1)
    ev.set()
    await w
    async def limited(i):
        async with sem:
            print("sem in", i)
            await asyncio.sleep(0.1)
            print("sem out", i)
    await asyncio.gather(*(limited(i) for i in range(4)))
    async with asyncio.TaskGroup() as tg:
        a = tg.create_task(worker("g1", 0.1))
        b = tg.create_task(worker("g2", 0.05))
    print(a.result(), b.result())
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(worker("e1", 0.1))
            tg.create_task(worker("e2", 0.05, True))
    except* ValueError as eg:
        print("group", [str(e) for e in eg.exceptions])
    async with asyncio.timeout(0.1):
        await asyncio.sleep(0.01)
    try:
        async with asyncio.timeout(0.05):
            await asyncio.sleep(1)
    except TimeoutError:
        print("timeout ctx")
    for coro in asyncio.as_completed([worker("s", 0.3), worker("f", 0.1)]):
        print("completed", await coro)
    done, pending = await asyncio.wait([asyncio.create_task(worker("w1", 0.1)), asyncio.create_task(worker("w2", 1))], timeout=0.5)
    print(len(done), len(pending))
    for p in pending: p.cancel()
    print([i async for i in agen()], [i * 2 async for i in agen() if i])
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    loop.call_later(0.1, fut.set_result, "later")
    loop.call_soon(print, "soon")
    print(await fut)
    print(await asyncio.to_thread(sum, [1, 2, 3]))
    print(await loop.run_in_executor(None, pow, 2, 10))
    print(await asyncio.shield(worker("sh", 0.1)))
    cv = contextvars.ContextVar("cv", default=0)
    async def setter():
        cv.set(5)
        return cv.get()
    print(await asyncio.create_task(setter()), cv.get())
    print(round(time.monotonic() - t0, 1), asyncio.current_task().get_name() is not None, len(asyncio.all_tasks()))

asyncio.run(main())
async def bad():
    raise RuntimeError("boom")
try:
    asyncio.run(bad())
except RuntimeError as e:
    print("run raised", e)
loop = asyncio.new_event_loop()
print(loop.run_until_complete(worker("z", 0.1)))
loop.close()
print(loop.is_closed())
asyncio.run(asyncio.sleep(0, "r"))
