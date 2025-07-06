import useDocTitle from '../../hooks/use-doc-title';

import Transitions from '../../animations/Transition';
import '../../css/error.css';

import { NavLink } from 'react-router';

import Button from 'react-bootstrap/Button';

const InternalServerError = () => {
    useDocTitle('F1 HD | ОШИБКА');
    return (
        <Transitions>
            <div id='error'>
                <div className='error'>
                    <div className='error-code'>
                        <h1>
                            5<span></span>0
                        </h1>
                    </div>
                    <h2>Упс! Всё сломалось</h2>
                    <p>К сожалению, на нашем сервере произошла ошибка. Мы уже работаем над её устранением</p>
                    <Button as={NavLink} to='/' variant='primary' size='lg'>
                        НА ГЛАВНУЮ
                    </Button>
                </div>
            </div>
        </Transitions>
    );
};

export default InternalServerError;
