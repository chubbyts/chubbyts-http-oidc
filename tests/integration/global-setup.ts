import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer, Wait } from 'testcontainers';

const image = 'ghcr.io/navikt/mock-oauth2-server:6.0.0';

// oxlint-disable-next-line functional/no-let
let container: StartedTestContainer | undefined;

const isReachable = async (serverUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${serverUrl}/default/.well-known/openid-configuration`);

    return response.ok;
  } catch {
    return false;
  }
};

export const setup = async (): Promise<void> => {
  const serverUrl = process.env.MOCK_OAUTH2_SERVER_URL ?? 'http://localhost:8080';

  if (await isReachable(serverUrl)) {
    return;
  }

  container = await new GenericContainer(image)
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp('/default/.well-known/openid-configuration', 8080).forStatusCode(200))
    .withStartupTimeout(120000)
    .start();

  // oxlint-disable-next-line functional/immutable-data
  process.env.MOCK_OAUTH2_SERVER_URL = `http://${container.getHost()}:${container.getMappedPort(8080)}`;
};

export const teardown = async (): Promise<void> => {
  await container?.stop();
};
