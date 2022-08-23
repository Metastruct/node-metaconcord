import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import Motd from "./Motd";

export { Motd };
export default function MotdProvider(container: Container): Service {
	return new Motd(container);
}
