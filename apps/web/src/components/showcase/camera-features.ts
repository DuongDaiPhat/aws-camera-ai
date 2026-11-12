import type { CameraPartId } from './camera-parts';
export type CameraFeatureId = 'fire' | 'fall' | 'face' | 'zone';
export const CAMERA_FEATURES = [
  {
    id: 'fire',
    icon: 'flame',
    title: 'Lửa & khói',
    description:
      'Quan sát cách camera hướng về đám cháy, xác định vùng nguy hiểm và chuyển thông tin thành cảnh báo.',
    action: 'Xem sự kiện',
    page: 'events',
    part: 'processor',
    result: 'Nguy hiểm · Phát hiện lửa',
    detail: 'Lửa và khói trong vùng quan sát',
    color: '#ff8b45',
  },
  {
    id: 'fall',
    icon: 'fall',
    title: 'Phát hiện té ngã',
    description:
      'Camera theo dõi dáng người và đánh dấu dấu hiệu té ngã để người giám sát kiểm tra, phản hồi.',
    action: 'Xem sự kiện',
    page: 'events',
    part: 'sensor',
    result: 'Cần kiểm tra · Dấu hiệu té ngã',
    detail: 'Đánh dấu người cần được hỗ trợ',
    color: '#ffbd69',
  },
  {
    id: 'face',
    icon: 'face',
    title: 'Nhận diện người',
    description:
      'Vùng quét tập trung vào khuôn mặt và minh họa quá trình đối chiếu với dữ liệu người quen đã đăng ký.',
    action: 'Quản lý người quen',
    page: 'known-faces',
    part: 'lens',
    result: 'Nhận diện · Đối chiếu khuôn mặt',
    detail: 'Vùng khuôn mặt được đánh dấu',
    color: '#65e3c4',
  },
  {
    id: 'zone',
    icon: 'zone',
    title: 'Khu vực giám sát',
    description:
      'Tạo vùng quan sát trên hình ảnh camera và nhận biết khi một người đi vào khu vực cần giám sát.',
    action: 'Thiết lập khu vực',
    page: 'zones',
    part: 'board',
    result: 'Khu vực · Có người đi vào vùng',
    detail: 'Ranh giới giám sát được kích hoạt',
    color: '#ba9bff',
  },
] as const satisfies readonly {
  id: CameraFeatureId;
  icon: string;
  title: string;
  description: string;
  action: string;
  page: string;
  part: CameraPartId;
  result: string;
  detail: string;
  color: string;
}[];
